import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

const DEFAULT_HOST = "127.0.0.1:7681";
const SESSION_KEY_PREFIX = "ghostty_session_";
const IS_EXTENSION = typeof chrome !== "undefined" && chrome.storage?.local;

// In web mode: use the page's own host. In extension mode: ?host= param or localhost.
function getBackendHost() {
  if (!IS_EXTENSION) {
    return location.host;
  }
  const params = new URLSearchParams(location.search);
  return params.get("host") || DEFAULT_HOST;
}

function httpBase() {
  if (!IS_EXTENSION) return location.origin;
  const host = getBackendHost();
  const proto = host.includes("trycloudflare.com") || host.includes("ngrok") ? "https" : "http";
  return `${proto}://${host}`;
}

function wsBase() {
  if (!IS_EXTENSION) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  }
  const host = getBackendHost();
  const proto = host.includes("trycloudflare.com") || host.includes("ngrok") ? "wss" : "ws";
  return `${proto}://${host}`;
}

// --- Config & Theme ---

async function loadConfig() {
  try {
    const res = await fetch(`${httpBase()}/config`);
    return await res.json();
  } catch {
    return null;
  }
}

function buildXtermTheme(t) {
  return {
    foreground: t.foreground,
    background: t.background,
    cursor: t.cursor,
    selectionBackground: t.selectionBackground,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  };
}

// --- Storage: chrome.storage in extension, localStorage in web mode ---

const storage = {
  get(key) {
    if (IS_EXTENSION) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (r) => resolve(r[key] || null));
      });
    }
    return Promise.resolve(localStorage.getItem(key));
  },
  set(key, value) {
    if (IS_EXTENSION) {
      return chrome.storage.local.set({ [key]: value });
    }
    localStorage.setItem(key, value);
    return Promise.resolve();
  },
  remove(key) {
    if (IS_EXTENSION) {
      return chrome.storage.local.remove(key);
    }
    localStorage.removeItem(key);
    return Promise.resolve();
  },
};

// --- Session persistence ---

function tabSessionKey() {
  if (!location.hash) {
    location.hash = crypto.randomUUID().slice(0, 8);
  }
  return SESSION_KEY_PREFIX + location.hash.slice(1);
}

function getSavedSessionId() {
  return storage.get(tabSessionKey());
}

function saveSessionId(id) {
  return storage.set(tabSessionKey(), id);
}

function getToken() {
  return storage.get("ghostty_token");
}

function setToken(newToken) {
  return storage.set("ghostty_token", newToken);
}

// --- Main ---

async function main() {
  const config = await loadConfig();
  const theme = config?.theme;
  const font = config?.font;

  // Apply background immediately
  if (theme) {
    document.documentElement.style.setProperty("--bg", theme.background);
  }

  const family = font?.family || "JetBrains Mono";
  // Quote font names for CSS, append monospace fallbacks
  const fontFamily = `'${family}', 'Fira Code', 'SF Mono', Menlo, monospace`;

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily,
    fontSize: font?.size || 14,
    lineHeight: 1.0,
    letterSpacing: 0,
    theme: theme ? buildXtermTheme(theme) : undefined,
    allowProposedApi: true,
    scrollback: 10000,
    fontWeight: "normal",
    fontWeightBold: "bold",
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const container = document.getElementById("terminal");

  // Wait for font to load before opening terminal (prevents cell metric mismatch)
  await document.fonts.load(`${font?.size || 14}px ${fontFamily}`).catch(() => {});

  term.open(container);

  // WebGL renderer — load after font is ready
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => webglAddon.dispose());
    term.loadAddon(webglAddon);
  } catch {
    console.warn("WebGL addon unavailable, using canvas renderer");
  }

  fitAddon.fit();
  window.addEventListener("resize", () => fitAddon.fit());

  // Update page title with shell activity
  term.onTitleChange((title) => {
    document.title = title || "Terminal";
  });

  // --- WebSocket connection ---

  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const sessionIdEl = document.getElementById("session-id");

  const storedToken = await getToken();

  const token = storedToken ?? await (async () => {
    const t = prompt("Paste the auth token from the ghostty-chrome backend output:");
    if (t) {
      await setToken(t.trim());
      return t.trim();
    }
    return null;
  })();

  if (!token) {
    term.write("\r\n\x1b[31mNo auth token provided. Start the backend and reload.\x1b[0m\r\n");
    return;
  }

  const savedSession = await getSavedSessionId();

  function connect() {
    const ws = new WebSocket(`${wsBase()}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      statusEl.className = "";
      statusText.textContent = "connected";

      if (savedSession) {
        ws.send(JSON.stringify({ type: "attach", id: savedSession, cols: term.cols, rows: term.rows }));
      } else {
        ws.send(JSON.stringify({ type: "new", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "session":
          saveSessionId(msg.id);
          sessionIdEl.textContent = msg.id;
          break;
        case "output":
          term.write(msg.data);
          break;
        case "scrollback":
          term.write(msg.data);
          break;
        case "exit":
          term.write(`\r\n\x1b[90m[process exited: ${msg.code}]\x1b[0m\r\n`);
          statusText.textContent = "exited";
          break;
      }
    };

    ws.onclose = (e) => {
      statusEl.className = "disconnected";
      if (e.code === 4001) {
        statusText.textContent = "invalid token";
        term.write("\r\n\x1b[31mAuth failed. Check token.\x1b[0m\r\n");
        storage.remove("ghostty_token");
        return;
      }
      statusText.textContent = "disconnected — reconnecting...";
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      statusText.textContent = "connection error";
    };

    // Terminal input → WebSocket
    term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "input", data }));
    });

    // Resize events
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    // Re-fit on resize
    new ResizeObserver(() => fitAddon.fit()).observe(container);
  }

  connect();
  term.focus();
}

main();
