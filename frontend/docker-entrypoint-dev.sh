#!/bin/sh
set -e
cd /app

if [ ! -f node_modules/.bin/vite ] || [ ! -f node_modules/.bin/nodemon ]; then
  echo "Installing npm dependencies (first run or empty node_modules volume)..."
  npm install --legacy-peer-deps
fi

exec "$@"
