#!/bin/sh
# Starts the Nexus API: sync schema, apply RLS, set the app role password, optionally seed.
set -e
cd /app/apps/api
echo "› Syncing database schema"
npx prisma db push --skip-generate
echo "› Applying row-level security"
npx prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma
echo "ALTER ROLE nexus_app WITH PASSWORD '${APP_DB_PASSWORD}';" | npx prisma db execute --stdin --schema prisma/schema.prisma
if [ "${SEED_ON_START}" = "true" ]; then
  echo "› Seeding demo data"
  npx ts-node prisma/seed.ts
fi
exec node dist/main.js
