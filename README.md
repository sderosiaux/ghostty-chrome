# Twitch Terminal

![Twitch Terminal](screenshot.png)

Stream your terminal. Watch AI agents work. Like Twitch, for shells.

## Stream in one command

```bash
./start.sh stream
```

```
share: https://farm-biblical-nut-yamaha.trycloudflare.com/?session=3ff37469&token=f9f638901
➜  ~
```

You're in a normal shell. Work as usual — run Claude Code, Codex, Aider, whatever. Send the share URL to anyone. They open it in their browser and watch your terminal live. Read-only, no install, no screen share.

`Ctrl+D` when you're done.

## Why not screen share?

There's no video. No frame encoding. No pixels. The stream is raw text — ANSI escape sequences over a WebSocket. A typical session is a few bytes per keystroke. Hundreds of viewers cost less bandwidth than one Google Meet call. The viewer's browser renders text locally — crisp at any resolution, instant at any distance.

## Use cases

- Watch how someone works with AI agents in real time
- Monitor a long-running agent session from your phone
- Pair-debug without screen sharing lag
- Live demo a CLI tool without everyone SSHing in
- Onboard devs by streaming how you navigate a codebase

## Install

```bash
git clone https://github.com/sderosiaux/twitch-terminal.git
cd twitch-terminal
npm install && cd backend && npm install && cd ../extension && npm install && node build.js && cd ..
```

Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for sharing (free, no account needed).

## Chrome extension (optional)

For personal use: run terminals inside Chrome tabs. Get tab pinning, tab groups, split panes, Ctrl+Shift+T to reopen, bookmarks — Chrome's tab management for your terminals.

```bash
./start.sh          # backend only, local
./start.sh share    # backend + tunnel for sharing
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `./extension/`

Each tab is a terminal. Click **share** in the status bar to stream any tab read-only.

## Security

- Viewers get a scoped guest token (HMAC-derived, one session only)
- Owner token is never in the share URL
- Read-only is server-enforced — input silently dropped
- Guests cannot create sessions or list other sessions
- Auth token is stripped from the shell environment

## License

MIT
