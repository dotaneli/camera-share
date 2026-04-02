#!/bin/bash
# Watch CameraShare remote logs from Firebase RTDB in real-time
# Usage: ./scripts/watch-logs.sh [--last N] [--follow] [--clear]

FIREBASE_URL="https://camera-share-e9232-default-rtdb.firebaseio.com/logs"
LAST=${2:-20}

case "${1}" in
  --clear)
    echo "Clearing all logs..."
    curl -s -X DELETE "${FIREBASE_URL}.json"
    echo " Done."
    exit 0
    ;;
  --last)
    echo "=== Last ${LAST} logs ==="
    curl -s "${FIREBASE_URL}.json?orderBy=%22\$key%22&limitToLast=${LAST}" | \
      python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data:
    print('No logs found.')
    sys.exit()
for key in sorted(data.keys()):
    e = data[key]
    ts = e.get('ts','?')
    lvl = e.get('lvl','?').upper()
    tag = e.get('tag','?')
    msg = e.get('msg','')
    extra = e.get('extra','')
    sid = e.get('sid','')[:6]
    color = {'DEBUG':'37','INFO':'34','WARN':'33','ERROR':'31','FATAL':'35'}.get(lvl,'0')
    print(f'\033[{color}m[{ts[11:19]}] {lvl:5} [{tag}] {msg}\033[0m' + (f' | {extra}' if extra else '') + f' (s:{sid})')
"
    ;;
  --follow)
    echo "=== Following logs (Ctrl+C to stop) ==="
    while true; do
      curl -s "${FIREBASE_URL}.json?orderBy=%22\$key%22&limitToLast=5" | \
        python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data:
    sys.exit()
for key in sorted(data.keys()):
    e = data[key]
    ts = e.get('ts','?')
    lvl = e.get('lvl','?').upper()
    tag = e.get('tag','?')
    msg = e.get('msg','')
    extra = e.get('extra','')
    color = {'DEBUG':'37','INFO':'34','WARN':'33','ERROR':'31','FATAL':'35'}.get(lvl,'0')
    print(f'\033[{color}m[{ts[11:19]}] {lvl:5} [{tag}] {msg}\033[0m' + (f' | {extra}' if extra else ''))
"
      sleep 3
      echo "--- polling ---"
    done
    ;;
  *)
    echo "CameraShare Log Viewer"
    echo "Usage:"
    echo "  ./scripts/watch-logs.sh --last [N]    Show last N logs (default 20)"
    echo "  ./scripts/watch-logs.sh --follow       Poll for new logs every 3s"
    echo "  ./scripts/watch-logs.sh --clear        Delete all logs"
    ;;
esac
