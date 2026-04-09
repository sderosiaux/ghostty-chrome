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

// --- URL params ---

function getUrlParams() {
  const params = new URLSearchParams(location.search);
  return {
    session: params.get("session"),             // join existing session
    mode: params.get("mode") || "ro",           // ro (default for guests) or rw
    token: params.get("token"),                 // token in URL for easy sharing
  };
}

// --- Main ---

async function main() {
  const config = await loadConfig();
  const theme = config?.theme;
  const font = config?.font;
  const urlParams = getUrlParams();

  if (theme) {
    document.documentElement.style.setProperty("--bg", theme.background);
  }

  const family = font?.family || "JetBrains Mono";
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

  await document.fonts.load(`${font?.size || 14}px ${fontFamily}`).catch(() => {});

  term.open(container);

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => webglAddon.dispose());
    term.loadAddon(webglAddon);
  } catch {
    console.warn("WebGL addon unavailable, using canvas renderer");
  }

  fitAddon.fit();
  window.addEventListener("resize", () => fitAddon.fit());

  term.onTitleChange((title) => {
    document.title = title || "Terminal";
  });

  // --- Status bar ---

  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const sessionIdEl = document.getElementById("session-id");
  const modeEl = document.getElementById("mode");
  const shareBtn = document.getElementById("share-btn");

  // Is this a guest joining an existing session?
  const isGuest = Boolean(urlParams.session);
  const guestSessionId = urlParams.session;
  const guestMode = urlParams.mode;

  // --- Token ---

  // Accept token from URL (share links) or storage or prompt
  const token = urlParams.token
    || await getToken()
    || await (async () => {
      const t = prompt("Paste the auth token:");
      if (t) {
        await setToken(t.trim());
        return t.trim();
      }
      return null;
    })();

  if (urlParams.token) await setToken(urlParams.token);

  if (!token) {
    term.write("\r\n\x1b[31mNo auth token provided.\x1b[0m\r\n");
    return;
  }

  const savedSession = isGuest ? null : await getSavedSessionId();
  let currentSessionId = null;
  let currentMode = isGuest ? guestMode : "rw";

  function updateStatusMode() {
    if (modeEl) {
      modeEl.textContent = currentMode === "ro" ? "read-only" : "read-write";
      modeEl.className = currentMode === "ro" ? "mode-ro" : "mode-rw";
    }
    if (shareBtn) {
      shareBtn.style.display = currentMode === "rw" ? "inline" : "none";
    }
    if (currentMode === "ro") {
      term.options.disableStdin = true;
      term.options.cursorBlink = false;
    }
  }

  function buildShareUrl(mode) {
    const base = httpBase();
    const params = new URLSearchParams({
      session: currentSessionId,
      mode,
      token,
    });
    return `${base}/?${params}`;
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const url = buildShareUrl("ro");
      navigator.clipboard.writeText(url).then(() => {
        shareBtn.textContent = "copied!";
        setTimeout(() => { shareBtn.textContent = "share"; }, 2000);
      });
    });
  }

  function connect() {
    const wsParams = new URLSearchParams({ token });
    if (isGuest) wsParams.set("session", guestSessionId);
    const ws = new WebSocket(`${wsBase()}?${wsParams}`);

    ws.onopen = () => {
      statusEl.className = "";
      statusText.textContent = "connected";

      if (isGuest) {
        // Guest: attach to the shared session
        ws.send(JSON.stringify({
          type: "attach",
          id: guestSessionId,
          mode: guestMode,
          cols: term.cols,
          rows: term.rows,
        }));
      } else if (savedSession) {
        // Owner: reconnect to own session
        ws.send(JSON.stringify({
          type: "attach",
          id: savedSession,
          mode: "rw",
          cols: term.cols,
          rows: term.rows,
        }));
      } else {
        // Owner: new session
        ws.send(JSON.stringify({ type: "new", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "session":
          currentSessionId = msg.id;
          currentMode = msg.mode || "rw";
          saveSessionId(msg.id);
          sessionIdEl.textContent = msg.id;
          updateStatusMode();
          break;
        case "output":
          term.write(msg.data);
          break;
        case "scrollback":
          term.write(msg.data);
          break;
        case "error":
          term.write(`\r\n\x1b[33m[${msg.message}]\x1b[0m`);
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

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "input", data }));
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    new ResizeObserver(() => fitAddon.fit()).observe(container);
  }

  connect();
  term.focus();
}

main();
