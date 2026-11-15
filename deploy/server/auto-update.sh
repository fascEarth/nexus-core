#!/usr/bin/env bash
# Cron job: redeploy when either repo has new commits on main. Safe to run often.
set -uo pipefail
ROOT=/opt/fascinora
exec 9>/var/lock/fascinora-update.lock
flock -n 9 || exit 0
changed=0
for r in nexus-core mediconsult; do
  git -C "$ROOT/$r" fetch -q origin main || continue
  if [ "$(git -C "$ROOT/$r" rev-parse HEAD)" != "$(git -C "$ROOT/$r" rev-parse origin/main)" ]; then changed=1; fi
done
[ "$changed" = 1 ] || exit 0
echo "=== $(date -u) deploying"
bash "$ROOT/nexus-core/deploy/server/update.sh"
