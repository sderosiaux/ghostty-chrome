#!/bin/bash
# Twitch Terminal — Stream your terminal. Like Twitch, for shells.

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$DIR/backend"
PID_FILE="$DIR/.backend.pid"
TUNNEL_PID_FILE="$DIR/.tunnel.pid"
TOKEN_FILE="$DIR/.token"
PORT="${PORT:-7681}"

GREEN='\033[0;32m'
DIM='\033[0;90m'
YELLOW='\033[0;33m'
NC='\033[0m'

stop_backend() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}

stop_tunnel() {
  if [ -f "$TUNNEL_PID_FILE" ]; then
    local pid
    pid=$(cat "$TUNNEL_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$TUNNEL_PID_FILE"
  fi
}

cleanup() {
  stop_tunnel
  stop_backend
}

ensure_token() {
  if [ ! -f "$TOKEN_FILE" ]; then
    openssl rand -hex 24 > "$TOKEN_FILE"
  fi
  cat "$TOKEN_FILE"
}

start_backend() {
  stop_backend
  local token
  token=$(ensure_token)

  cd "$BACKEND_DIR" || exit 1
  TWITCH_TERMINAL_TOKEN="$token" PORT="$PORT" node server.js > /dev/null 2>&1 &
  echo "$!" > "$PID_FILE"

  local _i
  for _i in $(seq 1 20); do
    if curl -sS "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo -e "${YELLOW}backend failed to start${NC}" >&2
  return 1
}

start_tunnel() {
  stop_tunnel

  if ! command -v cloudflared &> /dev/null; then
    echo -e "${YELLOW}cloudflared not found. brew install cloudflare/cloudflare/cloudflared${NC}" >&2
    return 1
  fi

  local tunnel_log="$DIR/.tunnel.log"
  : > "$tunnel_log"
  cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate 2>"$tunnel_log" &
  echo "$!" > "$TUNNEL_PID_FILE"

  local tunnel_url="" _i
  for _i in $(seq 1 30); do
    tunnel_url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$tunnel_log" 2>/dev/null | head -1 || true)
    if [ -n "$tunnel_url" ]; then break; fi
    sleep 1
  done

  if [ -z "$tunnel_url" ]; then
    echo -e "${YELLOW}tunnel failed${NC}" >&2
    return 1
  fi

  local token
  token=$(cat "$TOKEN_FILE")
  curl -sS "http://127.0.0.1:${PORT}/set-tunnel?token=${token}&url=${tunnel_url}" > /dev/null
  echo -e "${GREEN}tunnel${NC}: $tunnel_url" >&2
}

wait_forever() {
  echo -e "${DIM}Ctrl+C to stop${NC}"
  local backend_pid
  backend_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$backend_pid" ]; then wait "$backend_pid" 2>/dev/null || true
  else while true; do sleep 3600; done; fi
}

# --- Commands ---

cmd_stream() {
  trap cleanup EXIT INT TERM
  start_backend
  echo -e "${DIM}starting tunnel...${NC}" >&2
  start_tunnel || true
  echo "" >&2

  local token
  token=$(cat "$TOKEN_FILE")
  node "$BACKEND_DIR/attach.js" "$PORT" "$token"
}

cmd_start() {
  trap cleanup EXIT INT TERM
  start_backend
  echo -e "${GREEN}backend running${NC} (port $PORT)"
  echo -e "Extension: ${DIM}chrome://extensions → Load unpacked → ./extension/${NC}"
  wait_forever
}

cmd_share() {
  trap cleanup EXIT INT TERM
  start_backend
  echo -e "${GREEN}backend running${NC} (port $PORT)"
  echo -e "${DIM}starting tunnel...${NC}"
  start_tunnel || true
  echo ""
  echo -e "Click ${GREEN}share${NC} in the extension status bar to get a viewer URL."
  echo -e "${YELLOW}DO NOT share the owner token or the raw tunnel URL${NC}"
  wait_forever
}

case "${1:-stream}" in
  stream)  cmd_stream ;;
  start)   cmd_start ;;
  share)   cmd_share ;;
  stop)    stop_tunnel; stop_backend; echo -e "${DIM}stopped${NC}" ;;
  token)   [ -f "$TOKEN_FILE" ] && cat "$TOKEN_FILE" || echo "No token." ;;
  *)
    echo "Usage: $0 {stream|start|share|stop|token}"
    echo ""
    echo "  stream — stream your terminal (default, no Chrome needed)"
    echo "  start  — backend only (for Chrome extension)"
    echo "  share  — backend + tunnel (for Chrome extension)"
    echo "  stop   — kill everything"
    echo "  token  — print auth token"
    ;;
esac
