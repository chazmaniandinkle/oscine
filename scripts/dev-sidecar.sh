#!/bin/bash
# Dev sidecar for Oscine against the cog workspace. Idempotent: kills any
# previous instance on the port, holds stdin open on a FIFO (the server is an
# MCP stdio process and exits on EOF), logs to /tmp/oscine-dev.log.
set -u
PORT=${OSCINE_PORT:-7351}
OSC=${OSCINE_OSC_PORT:-7361}
ROOT=${OSCINE_PROJECT_ROOT:-/Users/slowbro/workspaces/cog}
FIFO=/tmp/oscine-dev.fifo
LOG=/tmp/oscine-dev.log
cd /Users/slowbro/workspaces/oscine || exit 1
lsof -tiTCP:$PORT -sTCP:LISTEN | xargs -r kill 2>/dev/null
pkill -f "sleep 100000 > $FIFO" 2>/dev/null
rm -f "$FIFO"; mkfifo "$FIFO"
( sleep 100000 > "$FIFO" & )
OSCINE_PORT=$PORT OSCINE_OSC_PORT=$OSC OSCINE_PROJECT_ROOT="$ROOT" \
  nohup node plugin/server/oscine-mcp.mjs < "$FIFO" >> "$LOG" 2>&1 &
sleep 2
curl -sf "http://127.0.0.1:$PORT/health" && echo && echo "oscine dev: http://127.0.0.1:$PORT/  (root $ROOT, log $LOG)"
