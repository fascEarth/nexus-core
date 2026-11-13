# Nexus Core: API image + static web files. Build from the repo root.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY libs/shared-types/package.json libs/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w libs/shared-types \
 && cd apps/api && npx prisma generate && npx nest build \
 && cd ../web && npx ng build

# API runtime (keeps the Prisma CLI + ts-node for migrations, seed and nightly reset)
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "/app/deploy/api-entrypoint.sh"]

# Static web files, copied into the shared volume Caddy serves
FROM busybox:stable AS web
COPY --from=build /app/apps/web/dist/web/browser /site
CMD ["sh", "-c", "rm -rf /out/* && cp -r /site/. /out/ && echo 'nexus web copied'"]
