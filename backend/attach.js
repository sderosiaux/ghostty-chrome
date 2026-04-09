// CLI attach: connects stdin/stdout to a backend session via WebSocket
// Usage: node attach.js <port> <token>

import { WebSocket } from "ws";
import { createHmac } from "crypto";

const PORT = process.argv[2] || "7681";
const TOKEN = process.argv[3];

if (!TOKEN) {
  process.stderr.write("Usage: node attach.js <port> <token>\n");
  process.exit(1);
}

function guestToken(sessionId) {
  return createHmac("sha256", TOKEN).update(sessionId).digest("hex").slice(0, 32);
}

// Fetch tunnel URL from backend
async function getTunnelUrl() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/tunnel?token=${encodeURIComponent(TOKEN)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch { return null; }
}

const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${encodeURIComponent(TOKEN)}`);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "new", cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case "session": {
      const tunnel = await getTunnelUrl();
      const base = tunnel || `http://127.0.0.1:${PORT}`;
      const gt = guestToken(msg.id);
      const shareUrl = `${base}/?session=${msg.id}&token=${gt}`;

      process.stderr.write(`\n\x1b[32mshare url\x1b[0m: ${shareUrl}\n`);
      process.stderr.write(`\x1b[90mread-only, no install needed\x1b[0m\n\n`);
      // Set terminal title
      process.stderr.write(`\x1b]0;twitch-terminal [${msg.id}]\x07`);
      break;
    }
    case "output":
    case "scrollback":
      process.stdout.write(msg.data);
      break;
    case "exit":
      process.exit(msg.code || 0);
      break;
  }
});

ws.on("close", () => process.exit(0));
ws.on("error", (e) => {
  process.stderr.write(`connection error: ${e.message}\n`);
  process.exit(1);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (data) => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "input", data: data.toString() }));
  }
});

process.stdout.on("resize", () => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns, rows: process.stdout.rows }));
  }
});
