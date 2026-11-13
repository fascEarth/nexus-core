#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 server (Oracle Cloud Ampere A1 or any VPS).
#   curl -fsSL https://raw.githubusercontent.com/fascEarth/nexus-core/main/deploy/server/setup.sh | bash -s -- you@email.com
set -euo pipefail
EMAIL="${1:-}"
ROOT=/opt/fascinora

if [ -z "$EMAIL" ]; then echo "Usage: setup.sh <email-for-https-certificates>"; exit 1; fi

echo "› Installing Docker"
sudo apt-get update -y
sudo apt-get install -y docker.io docker-compose-v2 git openssl cron
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

echo "› Opening ports 80/443 in the OS firewall (Oracle images block them by default)"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi

echo "› Getting the code"
sudo mkdir -p "$ROOT" && sudo chown "$USER" "$ROOT"
cd "$ROOT"
[ -d nexus-core ] || git clone https://github.com/fascEarth/nexus-core.git
[ -d mediconsult ] || git clone https://github.com/fascEarth/mediconsult.git

cd "$ROOT/nexus-core/deploy/server"
if [ ! -f .env ]; then
  echo "› Generating secrets"
  rnd() { openssl rand -hex 24; }
  cp .env.example .env
  sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=$EMAIL|" .env
  sed -i "s|^NEXUS_DB_PASSWORD=.*|NEXUS_DB_PASSWORD=$(rnd)|" .env
  sed -i "s|^NEXUS_APP_DB_PASSWORD=.*|NEXUS_APP_DB_PASSWORD=$(rnd)|" .env
  sed -i "s|^NEXUS_JWT_ACCESS_SECRET=.*|NEXUS_JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^NEXUS_JWT_REFRESH_SECRET=.*|NEXUS_JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^MEDI_DB_PASSWORD=.*|MEDI_DB_PASSWORD=$(rnd)|" .env
  sed -i "s|^MEDI_JWT_ACCESS_SECRET=.*|MEDI_JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^MEDI_DATA_ENCRYPTION_KEY=.*|MEDI_DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
  chmod 600 .env
fi

echo "› Building and starting (first build takes 10–20 minutes on a small server)"
sudo docker compose up -d --build

echo "› Scheduling the nightly demo reset (03:30 server time)"
( crontab -l 2>/dev/null | grep -v fascinora-reset; echo "30 3 * * * $ROOT/nexus-core/deploy/server/reset.sh >> /var/log/fascinora-reset.log 2>&1 # fascinora-reset" ) | crontab -

echo
echo "Done. Check: https://$(grep NEXUS_DOMAIN .env | cut -d= -f2)  and  https://$(grep MEDI_DOMAIN .env | cut -d= -f2)"
echo "Logs: cd $ROOT/nexus-core/deploy/server && sudo docker compose logs -f"
