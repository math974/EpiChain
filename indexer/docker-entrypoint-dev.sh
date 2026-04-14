#!/bin/sh
set -e
cd /app

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [ ! -f node_modules/.bin/tsx ]; then
  echo "Installing npm dependencies..."
  npm ci --ignore-scripts
fi

if [ ! -d src/generated/prisma ]; then
  echo "Generating Prisma client..."
  DATABASE_URL="${DATABASE_URL}" npx prisma generate
fi

echo "Applying database migrations..."
npx prisma migrate deploy

exec npm run dev
