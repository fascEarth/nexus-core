#!/usr/bin/env bash
# Nightly demo reset: wipe both demo databases and reseed. Visitors never leave real data behind.
set -euo pipefail
cd "$(dirname "$0")"
echo "[$(date -Is)] reset start"
sudo docker compose exec -T nexus-api sh -c 'npx prisma db push --force-reset --skip-generate --accept-data-loss && npx prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma && echo "ALTER ROLE nexus_app WITH PASSWORD '"'"'$APP_DB_PASSWORD'"'"';" | npx prisma db execute --stdin --schema prisma/schema.prisma && npx ts-node prisma/seed.ts'
sudo docker compose exec -T nexus-redis redis-cli FLUSHALL
sudo docker compose exec -T medi-api sh -c 'rm -rf /data/uploads/* && npx prisma db push --force-reset --skip-generate --accept-data-loss && npx prisma db execute --file prisma/constraints.sql --schema prisma/schema.prisma && npx ts-node prisma/seed.ts'
sudo docker compose restart nexus-api medi-api
echo "[$(date -Is)] reset done"
