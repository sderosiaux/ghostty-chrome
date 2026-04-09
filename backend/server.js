import { WebSocketServer } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "node-pty";
import { randomBytes, createHmac } from "crypto";
import { homedir } from "os";
import { parseTerminalConfig } from "./config-parser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const STATIC_DIR = resolve(join(__dirname, "..", "extension"));

const PORT = parseInt(process.env.PORT || "7681", 10);
const AUTH_TOKEN = process.env.TWITCH_TERMINAL_TOKEN || randomBytes(24).toString("hex");
let tunnelUrl = process.env.TUNNEL_URL || null;

// Strip sensitive vars from PTY environment
const { TWITCH_TERMINAL_TOKEN: _stripped, ...safeEnv } = process.env;

// Session store
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const terminalConfig = parseTerminalConfig();
const defaultShell = terminalConfig.shell || process.env.SHELL || "/bin/zsh";

// --- Guest token: HMAC(ownerToken, sessionId) scoped to one session, read-only ---

function generateGuestToken(sessionId) {
  return createHmac("sha256", AUTH_TOKEN).update(sessionId).digest("hex").slice(0, 32);
}

function verifyGuestToken(guestToken, sessionId) {
  return guestToken === generateGuestToken(sessionId);
}

// --- Session management ---

function createSession(cols = 120, rows = 30) {
  const id = randomBytes(8).toString("hex");

  const pty = spawn(defaultShell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: homedir(),
    env: { ...safeEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });

  const session = {
    id,
    pty,
    scrollback: [],
    clients: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  const MAX_SCROLLBACK = 50000;

  pty.onData((data) => {
    session.lastActivity = Date.now();
    session.scrollback.push(data);
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK / 2);
    }
    for (const ws of session.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  pty.onExit(({ exitCode }) => {
    for (const ws of session.clients) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      }
    }
    sessions.delete(id);
  });

  sessions.set(id, session);
  return session;
}

function attachClient(ws, session) {
  session.clients.add(ws);
  if (session.scrollback.length > 0) {
    ws.send(
      JSON.stringify({
        type: "scrollback",
        data: session.scrollback.join(""),
      })
    );
  }
}

// Cleanup stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.clients.size === 0 && now - session.lastActivity > SESSION_TTL_MS) {
      session.pty.kill();
      sessions.delete(id);
    }
  }
}, 60_000);

// --- HTTP server ---

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // CORS: allow chrome-extension:// and tunnel origins
  const origin = req.headers.origin || "";
  if (origin.startsWith("chrome-extension://") || origin.includes("trycloudflare.com")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  if (url.pathname === "/config") {
    const t = url.searchParams.get("token");
    if (t !== AUTH_TOKEN) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(terminalConfig));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Internal: start.sh sets tunnel URL after cloudflared starts
  if (url.pathname === "/set-tunnel") {
    const t = url.searchParams.get("token");
    if (t !== AUTH_TOKEN) { res.writeHead(401); res.end(); return; }
    tunnelUrl = url.searchParams.get("url") || null;
    res.writeHead(200);
    res.end();
    return;
  }

  // Extension queries this to build share URLs
  if (url.pathname === "/tunnel") {
    const t = url.searchParams.get("token");
    if (t !== AUTH_TOKEN) { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: tunnelUrl }));
    return;
  }

  // Serve static files for web guests
  const filePath = url.pathname === "/"
    ? join(STATIC_DIR, "terminal.html")
    : join(STATIC_DIR, url.pathname);

  const resolved = resolve(filePath);
  if (!resolved.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (existsSync(resolved)) {
    const mime = MIME[extname(resolved)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(resolved));
    return;
  }

  res.writeHead(404);
  res.end();
});

// --- WebSocket ---

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const token = url.searchParams.get("token");
  const guestSessionId = url.searchParams.get("session");

  // Auth: either owner token, or valid guest token for a specific session
  const isOwner = token === AUTH_TOKEN && !guestSessionId;
  const isGuest = Boolean(guestSessionId) && verifyGuestToken(token, guestSessionId);

  if (!isOwner && !isGuest) {
    ws.close(4001, "Unauthorized");
    return;
  }

  let session = null;
  const readonly = isGuest; // Guests are ALWAYS read-only, server-enforced

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "new": {
        if (isGuest) {
          ws.send(JSON.stringify({ type: "error", message: "forbidden" }));
          ws.close(4003, "Forbidden");
          break;
        }
        session = createSession(msg.cols || 120, msg.rows || 30);
        attachClient(ws, session);
        ws.send(JSON.stringify({
          type: "session",
          id: session.id,
          mode: "rw",
          guestToken: generateGuestToken(session.id),
        }));
        break;
      }

      case "attach": {
        const targetId = isGuest ? guestSessionId : msg.id;
        session = sessions.get(targetId);

        if (!session) {
          if (isGuest) {
            ws.send(JSON.stringify({ type: "error", message: "session not found" }));
            ws.close(4004, "Session not found");
            break;
          }
          // Owner reconnecting to expired session — fresh shell, new random ID
          session = createSession(msg.cols || 120, msg.rows || 30);
        }

        attachClient(ws, session);
        const response = {
          type: "session",
          id: session.id,
          mode: readonly ? "ro" : "rw",
        };
        if (isOwner) {
          response.guestToken = generateGuestToken(session.id);
        }
        ws.send(JSON.stringify(response));
        break;
      }

      case "input": {
        if (readonly) break; // silently drop, no error spam
        if (session) session.pty.write(msg.data);
        break;
      }

      case "resize": {
        if (!readonly && session && msg.cols && msg.rows) {
          session.pty.resize(msg.cols, msg.rows);
        }
        break;
      }

      case "list": {
        if (isGuest) break;
        const list = [...sessions.entries()].map(([id, s]) => ({
          id,
          alive: !s.pty.killed,
          clients: s.clients.size,
          age: Date.now() - s.createdAt,
        }));
        ws.send(JSON.stringify({ type: "sessions", list }));
        break;
      }
    }
  });

  ws.on("close", () => {
    if (session) session.clients.delete(ws);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`twitch-terminal backend`);
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log(`  token: ${AUTH_TOKEN}`);
  console.log(`  shell: ${defaultShell}`);
});
