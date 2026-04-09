# Twitch Terminal

![Twitch Terminal](screenshot.png)

Stream your terminal. Watch AI agents work. Like Twitch, for shells.

> One click to broadcast a read-only view of your terminal to anyone with a browser. No install, no screen share, no lag. They see exactly what you see — raw terminal output over WebSocket.

## Why

You're running Claude Code, Codex, or Aider. Your colleague wants to watch. Screen sharing compresses everything into blurry video at 2fps. Instead: click **share**, send the URL, they open it and see your terminal live — crisp text, zero lag, read-only by default.

Or you kick off a long agent session, leave your desk. Pull out your phone, open the URL, monitor it from anywhere.

- Watch how someone works with AI agents in real time
- Monitor long-running agent sessions remotely
- Pair-debug without screen sharing — raw terminal, not compressed video
- Live demo a CLI tool without everyone SSHing in
- Onboard devs by streaming how you navigate a codebase

## Quick start

```bash
git clone https://github.com/sderosiaux/twitch-terminal.git
cd twitch-terminal
npm install && cd backend && npm install && cd ../extension && npm install && node build.js && cd ..

# Local only
./start.sh

# With sharing (Cloudflare tunnel, free)
./start.sh share
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `./extension/`

## How sharing works

1. `./start.sh share` — starts backend + Cloudflare tunnel
2. Open a terminal tab, work normally
3. Click **share** in the status bar → read-only URL copied to clipboard
4. Send URL to anyone → they open it, see your terminal live, can't type

The viewer needs nothing — no extension, no install. Just a browser.

## Security

Sharing exposes a read-only view, nothing more.

- Guest tokens are HMAC-derived, scoped to a single session
- Owner token is never in the share URL
- Read-only is server-enforced — crafted WebSocket messages are silently dropped
- Guests cannot create sessions, list sessions, or resize the terminal
- Auth token is stripped from the shell environment

## Roadmap

- [x] Terminal in Chrome tabs with session persistence
- [x] One-click read-only streaming via Cloudflare tunnel
- [x] Scoped guest tokens (HMAC, per-session)
- [x] Font import from Ghostty config
- [ ] Theme import from Ghostty config (named themes like Catppuccin)
- [ ] Viewer count in status bar
- [ ] Session picker
- [ ] launchd daemon for auto-start

## License

MIT
