#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
if [[ ! -f assets/audio/digit-8.wav ]]; then
  echo "Generating dichotic speech tokens (first run)…"
  python3 scripts/generate-audio.py
fi
echo "ASTB-PBM trainer → http://localhost:${PORT}"
echo "Open that URL in Chrome. Plug in the X-52, put the headset on, start with Hardware bench."
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
