#!/bin/bash
# Ghostty Chrome — launcher
# Starts the PTY backend and optionally a Cloudflare tunnel for sharing

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
      echo -e "${DIM}backend stopped${NC}"
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
      echo -e "${DIM}tunnel stopped${NC}"
    fi
    rm -f "$TUNNEL_PID_FILE"
  fi
}

cleanup() {
  stop_tunnel
  stop_backend
}
trap cleanup EXIT INT TERM

start_backend() {
  stop_backend

  if [ ! -f "$TOKEN_FILE" ]; then
    openssl rand -hex 24 > "$TOKEN_FILE"
  fi
  local token
  token=$(cat "$TOKEN_FILE")

  cd "$BACKEND_DIR" || exit 1
  GHOSTTY_TOKEN="$token" PORT="$PORT" node server.js &
  echo "$!" > "$PID_FILE"

  # Wait for backend to be ready
  local _i
  for _i in $(seq 1 20); do
    if curl -sS "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done

  echo -e "${GREEN}backend running${NC} (port $PORT)"
  echo -e "${DIM}token: $token${NC}"
  echo ""
}

start_tunnel() {
  stop_tunnel

  if ! command -v cloudflared &> /dev/null; then
    echo -e "${YELLOW}cloudflared not found. Install: brew install cloudflare/cloudflare/cloudflared${NC}"
    return 1
  fi

  local tunnel_log="$DIR/.tunnel.log"
  : > "$tunnel_log"

  cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate 2>"$tunnel_log" &
  echo "$!" > "$TUNNEL_PID_FILE"

  echo -e "${DIM}waiting for tunnel...${NC}"

  local tunnel_url=""
  local _i
  for _i in $(seq 1 30); do
    tunnel_url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$tunnel_log" 2>/dev/null | head -1 || true)
    if [ -n "$tunnel_url" ]; then
      break
    fi
    sleep 1
  done

  if [ -z "$tunnel_url" ]; then
    echo -e "${YELLOW}tunnel failed to start — check $tunnel_log${NC}"
    cat "$tunnel_log" | tail -5
    return 1
  fi

  local token tunnel_host
  token=$(cat "$TOKEN_FILE")
  tunnel_host="${tunnel_url#https://}"

  echo -e "${GREEN}tunnel active${NC}: $tunnel_url"
  echo ""
  echo -e "Share this to a collaborator:"
  echo -e "  tunnel host: ${GREEN}${tunnel_host}${NC}"
  echo -e "  token:       ${GREEN}${token}${NC}"
  echo ""
  echo -e "${DIM}They open: terminal.html?host=${tunnel_host} and paste the token${NC}"
  echo ""
}

block_forever() {
  echo -e "${DIM}Press Ctrl+C to stop${NC}"
  # Wait on the backend pid specifically
  local backend_pid
  backend_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$backend_pid" ]; then
    wait "$backend_pid" 2>/dev/null || true
  else
    # Fallback: sleep loop
    while true; do sleep 3600; done
  fi
}

case "${1:-start}" in
  start)
    start_backend
    echo -e "Load the extension from: ${GREEN}$DIR/extension${NC}"
    echo -e "Paste this token when prompted: ${GREEN}$(cat "$TOKEN_FILE")${NC}"
    echo ""
    block_forever
    ;;
  share)
    start_backend
    start_tunnel
    block_forever
    ;;
  stop)
    stop_tunnel
    stop_backend
    ;;
  token)
    [ -f "$TOKEN_FILE" ] && cat "$TOKEN_FILE" || echo "No token. Run 'start' first."
    ;;
  *)
    echo "Usage: $0 {start|share|stop|token}"
    echo ""
    echo "  start  — backend only (local)"
    echo "  share  — backend + Cloudflare tunnel (shareable)"
    echo "  stop   — kill everything"
    echo "  token  — print auth token"
    ;;
esac
