#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

echo "Applying database migrations..."
npx prisma migrate deploy

exec node dist/index.js
