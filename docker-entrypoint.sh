#!/bin/sh
set -e

# Make sure the persistent folders exist on the mounted volume.
mkdir -p /data/wwebjs_auth /data/wwebjs_cache

# Apply the Prisma schema to the SQLite DB that lives on the volume.
# (prisma generate already ran at build time.)
npx prisma db push --skip-generate

# Hand off to the CMD (npm start).
exec "$@"
