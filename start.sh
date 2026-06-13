#!/bin/sh
# Serve Oscine locally. Usage: ./start.sh [port]
cd "$(dirname "$0")"
PORT="${1:-8443}"
URL="http://localhost:$PORT"
echo "Oscine -> $URL"
command -v open >/dev/null 2>&1 && (sleep 1 && open "$URL") &
exec python3 -m http.server "$PORT"
