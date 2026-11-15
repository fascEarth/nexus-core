#!/usr/bin/env bash
# Cron job (every 10 min): redeploy when either repo has new commits on main.
# After deploying it health-checks both APIs; if either is down it rolls back to
# the previous commits and remembers the bad pair so it is not retried.
set -uo pipefail
# Run from a copy: this file lives in the repo it is about to update.
if [ "${FASCINORA_COPY:-}" != 1 ]; then
  cp "$0" /tmp/fascinora-auto-update.sh && FASCINORA_COPY=1 exec bash /tmp/fascinora-auto-update.sh "$@"
fi
ROOT=/opt/fascinora
STATE=/var/lib/fascinora
COMPOSE_DIR="$ROOT/nexus-core/deploy/server"
mkdir -p "$STATE/public"
status() { # status <result> <message>
  printf '{"result":"%s","message":"%s","nexus":"%s","mediconsult":"%s","time":"%s"}\n' \
    "$1" "$2" "$(git -C "$ROOT/nexus-core" rev-parse --short HEAD)" "$(git -C "$ROOT/mediconsult" rev-parse --short HEAD)" \
    "$(date -u +%FT%TZ)" > "$STATE/public/deploy-status.json"
}
exec 9>/var/lock/fascinora-update.lock
flock -n 9 || exit 0

head_of()   { git -C "$ROOT/$1" rev-parse "$2"; }
for r in nexus-core mediconsult; do git -C "$ROOT/$r" fetch -q origin main || exit 0; done

OLD_N=$(head_of nexus-core HEAD);   NEW_N=$(head_of nexus-core origin/main)
OLD_M=$(head_of mediconsult HEAD);  NEW_M=$(head_of mediconsult origin/main)
[ "$OLD_N$OLD_M" = "$NEW_N$NEW_M" ] && exit 0
PAIR="$NEW_N $NEW_M"
grep -qxF "$PAIR" "$STATE/bad-commits" 2>/dev/null && exit 0
status deploying "building ${NEW_N:0:7} / ${NEW_M:0:7}"

healthy() {
  local i
  for i in $(seq 1 18); do
    sleep 10
    if docker exec fascinora-caddy-1 wget -qO- http://nexus-api:3000/health 2>/dev/null | grep -q '"ok"' \
      && docker exec fascinora-caddy-1 wget -qO- http://medi-api:3100/api/v1/doctors 2>/dev/null | grep -q '"items"'; then
      return 0
    fi
  done
  return 1
}

echo "=== $(date -u) deploying nexus ${NEW_N:0:7} / medi ${NEW_M:0:7}"
git -C "$ROOT/nexus-core" reset -q --hard "$NEW_N"
git -C "$ROOT/mediconsult" reset -q --hard "$NEW_M"
if (cd "$COMPOSE_DIR" && docker compose up -d --build) && healthy; then
  docker image prune -f >/dev/null
  echo "=== $(date -u) deploy OK"
  status ok "deployed"
  exit 0
fi

echo "=== $(date -u) deploy FAILED - rolling back to ${OLD_N:0:7} / ${OLD_M:0:7}"
echo "$PAIR" >> "$STATE/bad-commits"
for svc in nexus-api medi-api; do docker logs --tail 40 "fascinora-$svc-1" 2>&1 | sed "s/^/[$svc] /"; done | tee /tmp/fascinora-fail.log
FIRST_ERR=$(grep -m1 -oE '[A-Za-z]*Error[^"\\]{0,160}' /tmp/fascinora-fail.log | tr -d '"\\' || true)
git -C "$ROOT/nexus-core" reset -q --hard "$OLD_N"
git -C "$ROOT/mediconsult" reset -q --hard "$OLD_M"
if (cd "$COMPOSE_DIR" && docker compose up -d --build) && healthy; then
  echo "=== rollback OK"; status rolled-back "new commits ${NEW_N:0:7} / ${NEW_M:0:7} failed: ${FIRST_ERR:-health check}"
else
  echo "=== rollback ALSO FAILED"; status down "rollback failed"
fi
