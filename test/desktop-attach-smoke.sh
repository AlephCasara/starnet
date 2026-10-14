#!/usr/bin/env bash
# test/desktop-attach-smoke.sh — bounded Linux desktop smoke: init → attach → survive → clean exit.
#
# The full GUI journey stays a human/CI-with-display concern; this smoke proves
# the packaged Tauri shell behaves correctly in external-attach mode against a
# real packaged station:
#   · NEGATIVE: with no station on the port, the shell aborts during setup
#     (discover_token fails closed) instead of spawning its own sidecar;
#   · POSITIVE: with the station up, the shell stays alive past setup — which
#     only happens after the bootstrap token was obtained, because a failed
#     discovery is a setup error that kills the app — spawns no second sidecar,
#     and leaves the station healthy when it exits.
# Wayland/GBM quirks are bypassed with the WebKit software rendering switches;
# nothing here changes production behavior. The app-data dir follows the OS
# user (not $HOME), so the smoke does not rely on startup.log placement.
#
# Usage: desktop-attach-smoke.sh <starnet-server-bin> <starnet-desktop-bin> [xvfb-run-bin]
set -u
SERVER="$1"; DESKTOP="$2"; XVFB_RUN="${3:-}"
fail=0
ok()   { echo "ok - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }
TMP="$(mktemp -d)"
export HOME="$TMP/home"; mkdir -p "$HOME"
WS="$TMP/ws"; mkdir -p "$WS"
PORT=48799
DEAD_PORT=48798
DISPLAY_NR=99
cleanup() {
  [ -n "${DESKTOP_PID:-}" ] && kill "$DESKTOP_PID" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

launch_desktop() { # $1 = port
  export STARNET_DESKTOP_SIDECAR_MODE=attach
  export STARNET_PORT="$1"
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
  unset WAYLAND_DISPLAY || true
  if [ -n "$XVFB_RUN" ]; then
    "$XVFB_RUN" -a "$DESKTOP" >/dev/null 2>&1 &
  else
    export DISPLAY=":$DISPLAY_NR"
    "$DESKTOP" >/dev/null 2>&1 &
  fi
  DESKTOP_PID=$!
}

alive_after() { # $1 = pid, $2 = seconds
  local i
  for i in $(seq 1 $((2 * $2))); do
    sleep 0.5
    kill -0 "$1" 2>/dev/null || return 1
  done
  return 0
}

# 0. X server for the shell (non-xvfb-run path)
if [ -z "$XVFB_RUN" ]; then
  Xvfb ":$DISPLAY_NR" -screen 0 1280x800x24 >/dev/null 2>&1 &
  XVFB_PID=$!
  sleep 1
fi

# 1. NEGATIVE: attach to a dead port must abort the shell during setup
launch_desktop "$DEAD_PORT"
if alive_after "$DESKTOP_PID" 6; then
  bad "desktop kept running against a dead port instead of failing closed"
else
  ok "desktop aborts fail-closed when no station answers"
fi
kill "$DESKTOP_PID" 2>/dev/null; wait "$DESKTOP_PID" 2>/dev/null; DESKTOP_PID=""

# 2. station first (the only sidecar authority)
STARNET_PORT=$PORT SKYNET_PORT=$PORT STARNET_WORKSPACES="$WS" "$SERVER" >/dev/null 2>&1 &
SERVER_PID=$!
for i in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && ok "station healthy on :$PORT" || { bad "station never became healthy"; exit 1; }
NODE_BEFORE=$(pgrep -c -f "node .*sidecar/index.js" 2>/dev/null || echo 0)

# 3. POSITIVE: attach to the live station and survive past setup
launch_desktop "$PORT"
if alive_after "$DESKTOP_PID" 6; then
  ok "desktop survives setup against the live station (bootstrap token obtained)"
else
  bad "desktop exited during setup against a healthy station"
fi
NODE_DURING=$(pgrep -c -f "node .*sidecar/index.js" 2>/dev/null || echo 0)
[ "$NODE_DURING" -le "$NODE_BEFORE" ] && ok "no second sidecar spawned by the desktop" || bad "desktop spawned another sidecar ($NODE_BEFORE -> $NODE_DURING)"

# 4. desktop exit must not touch the station
kill "$DESKTOP_PID" 2>/dev/null; DESKTOP_PID=""
sleep 2
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && ok "station healthy after desktop exit" || bad "station died with the desktop"
kill -0 "$SERVER_PID" 2>/dev/null && ok "station process survived desktop exit" || bad "station process was reaped"

exit $fail
