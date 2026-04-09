import { WebSocketServer } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "node-pty";
import { randomBytes } from "crypto";
import { homedir } from "os";
import { parseGhosttyConfig } from "./config-parser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const STATIC_DIR = join(__dirname, "..", "extension");

const PORT = parseInt(process.env.PORT || "7681", 10);
const AUTH_TOKEN = process.env.GHOSTTY_TOKEN || randomBytes(24).toString("hex");

// Session store: keeps PTY alive even when client disconnects
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const ghosttyConfig = parseGhosttyConfig();
const defaultShell = ghosttyConfig.shell || process.env.SHELL || "/bin/zsh";

function createSession(id, cols = 120, rows = 30) {
  const pty = spawn(defaultShell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: homedir(),
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
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

// Single HTTP server — serves config + WebSocket upgrade on same port
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // CORS for tunnel access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (url.pathname === "/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ghosttyConfig));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
    return;
  }

  // Serve extension static files (web mode for tunnel guests)
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".map": "application/json",
  };

  const filePath = url.pathname === "/"
    ? join(STATIC_DIR, "terminal.html")
    : join(STATIC_DIR, url.pathname);

  // Prevent path traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (existsSync(filePath)) {
    const mime = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(filePath));
    return;
  }

  res.writeHead(404);
  res.end();
});

// WebSocket on the same HTTP server (upgrade)
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const token = url.searchParams.get("token");

  if (token !== AUTH_TOKEN) {
    ws.close(4001, "Unauthorized");
    return;
  }

  let session = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "new": {
        const id = randomBytes(8).toString("hex");
        session = createSession(id, msg.cols || 120, msg.rows || 30);
        attachClient(ws, session);
        ws.send(JSON.stringify({ type: "session", id }));
        break;
      }

      case "attach": {
        session = sessions.get(msg.id);
        if (!session) {
          session = createSession(msg.id, msg.cols || 120, msg.rows || 30);
        }
        attachClient(ws, session);
        ws.send(JSON.stringify({ type: "session", id: session.id }));
        break;
      }

      case "input": {
        if (session) session.pty.write(msg.data);
        break;
      }

      case "resize": {
        if (session && msg.cols && msg.rows) {
          session.pty.resize(msg.cols, msg.rows);
        }
        break;
      }

      case "list": {
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
  console.log(`ghostty-chrome backend`);
  console.log(`  http://127.0.0.1:${PORT} (config + websocket)`);
  console.log(`  token: ${AUTH_TOKEN}`);
  console.log(`  shell: ${defaultShell}`);
  console.log(`  theme: ${ghosttyConfig.theme.background} / ${ghosttyConfig.theme.foreground}`);
});
