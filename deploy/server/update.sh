#!/usr/bin/env bash
# Pull the latest code for both apps and redeploy with zero config changes.
set -euo pipefail
ROOT=/opt/fascinora
git -C "$ROOT/nexus-core" pull --ff-only
git -C "$ROOT/mediconsult" pull --ff-only
cd "$ROOT/nexus-core/deploy/server"
sudo docker compose up -d --build
sudo docker image prune -f
echo "Deployed $(git -C $ROOT/nexus-core rev-parse --short HEAD) / $(git -C $ROOT/mediconsult rev-parse --short HEAD)"
