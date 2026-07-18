#!/bin/zsh
set -e

cd -- "${0:A:h}"

port=8765
url="http://127.0.0.1:${port}/"

python3 -m http.server "$port" --bind 127.0.0.1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

sleep 0.5
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo "Could not start evolve. Port $port may already be in use."
  wait "$server_pid"
  exit 1
fi
open "$url"

echo "evolve is running at $url"
echo "Close this Terminal window or press Control-C to stop."
wait "$server_pid"
