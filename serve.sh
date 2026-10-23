#!/bin/sh
# Serve the map on http://localhost:8000 (OpenStreetMap tiles are refused without a Referer, which file:// never sends).
cd "$(dirname "$0")" && echo "Open http://localhost:8000/" && exec python3 -m http.server 8000 --bind 127.0.0.1
