# Ghostty Chrome

![Ghostty Chrome](screenshot.png)

Your terminal, in Chrome tabs. Powered by [xterm.js](https://xtermjs.org/) and [node-pty](https://github.com/microsoft/node-pty).

> **Why?** Chrome is the best tab manager ever built — pinning, tab grouping, split panes, Ctrl+Shift+T to reopen, bookmarks, cross-device sync. Your terminals get all of that for free. No need to reinvent tab management or split views — Chrome already does it better than any terminal app.

> **Status**: The current MVP uses xterm.js to prove the concept works. The end goal is to compile [libghostty](https://github.com/ghostty-org/ghostty) (Zig) to WebAssembly — same VT parser, same rendering fidelity, running natively in the browser. xterm.js is the scaffolding, not the destination.

## How it works

```
Chrome Tab ←→ Extension (xterm.js + WebGL) ←→ WebSocket ←→ Backend (Node) ←→ PTY (/bin/zsh)
Chrome Tab ←→ Extension (xterm.js + WebGL) ←→ WebSocket ↗
```

- **Backend**: Node.js server that spawns real shell processes via PTY, bridges I/O over WebSocket
- **Extension**: Chrome Manifest V3 extension with xterm.js rendering on a `<canvas>` (WebGL)
- **Sessions persist**: close a tab, the shell keeps running server-side — reopen and you're back where you left off
- **Ghostty theming**: reads your `~/.config/ghostty/config` (or `~/Library/Application Support/com.mitchellh.ghostty/config`) for colors and font

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/sderosiaux/ghostty-chrome.git
cd ghostty-chrome
npm install
cd backend && npm install && cd ..
cd extension && npm install && node build.js && cd ..

# 2. Start the backend
./start.sh
# → note the auth token printed

# 3. Load the extension
# Open chrome://extensions → enable Developer mode → Load unpacked → select ./extension/
# Click the extension icon → new terminal tab → paste the token when prompted
```

## Features

- **Each tab = a terminal** with its own shell process
- **Session persistence** — sessions survive tab close for 24h, reconnect via Ctrl+Shift+T or bookmarks
- **WebGL rendering** — same engine as VS Code's terminal, GPU-accelerated
- **Ghostty config** — auto-imports your font, colors, and size
- **Token auth** — localhost-only, one token per backend instance
- **Scrollback** — 10K lines client-side, 50K chunks server-side for replay on reconnect

## Bookmark your terminals

Each terminal tab has a unique URL hash (`terminal.html#a1b2c3d4`). Bookmark it — reopening the bookmark reconnects to the same session. If the session expired, you get a fresh shell at the same URL.

## App mode (full keybindings)

Chrome captures some shortcuts (Ctrl+W, Ctrl+T). To get full terminal keybindings:

```bash
# Replace <EXTENSION_ID> with your extension's ID from chrome://extensions
open -na 'Google Chrome' --args --app='chrome-extension://<EXTENSION_ID>/terminal.html'
```

This opens a minimal Chrome window with no address bar and fewer captured shortcuts.

## Architecture

```
ghostty-chrome/
├── backend/
│   ├── server.js          # WebSocket + PTY multiplexer
│   └── config-parser.js   # Reads Ghostty config for theming
├── extension/
│   ├── manifest.json      # Chrome Extension Manifest V3
│   ├── background.js      # Service worker — opens new tabs
│   ├── terminal-src.js    # xterm.js setup, WebSocket client, session management
│   ├── terminal.html/css  # Terminal page
│   └── build.js           # esbuild bundler
├── eslint.config.js       # Strict linter (30+ rules)
├── start.sh               # Launcher script
└── .husky/pre-commit      # Lint on every commit
```

## Session lifecycle

| Event | What happens |
|---|---|
| New tab | Backend spawns a new PTY + zsh process |
| Tab closed | PTY stays alive server-side |
| Tab reopened (Ctrl+Shift+T / bookmark) | Reconnects to existing session, replays scrollback |
| 24h idle with no client | Session cleaned up |
| `exit` in terminal | PTY dies immediately |
| Backend killed (Ctrl+C) | All sessions lost |

## Performance

| | Ghostty native | Chrome (xterm.js WebGL) |
|---|---|---|
| Input latency | ~2ms | ~5-8ms |
| Scroll (large output) | GPU direct | ~2-4ms/frame |
| Memory per tab | ~15MB | ~40-60MB |
| Typing / vim / htop | Imperceptible difference | Imperceptible difference |

## Roadmap

**Phase 1 — MVP (current)**
- [x] xterm.js + WebGL proof of concept
- [x] Session persistence and reconnection
- [x] Ghostty config import (font, colors)
- [ ] Session picker page (list/attach to running sessions — backend API already exists)
- [ ] launchd daemon for backend auto-start
- [ ] Catppuccin/custom theme file support

**Phase 2 — libghostty WASM**
- [ ] Compile libghostty VT parser (Zig → wasm32) and swap out xterm.js parser
- [ ] Exact Ghostty terminal emulation in the browser

**Phase 3 — native rendering**
- [ ] WebGPU renderer matching Ghostty's GPU pipeline
- [ ] Font shaping via harfbuzz-wasm

## License

MIT
