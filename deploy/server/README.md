# Fascinora product server

Runs **Nexus Core** and **MediConsult** on one server with automatic HTTPS:

| URL | Serves |
|---|---|
| https://nexus.fascinora.com | Nexus web + `/api`, `/socket.io` → nexus-api |
| https://mediconsult.fascinora.com | MediConsult web + `/api`, `/socket.io` → medi-api |

Stack: Caddy (TLS, security headers) · two NestJS APIs · Postgres 16 ×2 · Redis. Fits an Oracle Cloud Always Free Ampere A1 (2 OCPU / 12 GB).

## One-time setup

1. **Oracle Cloud:** create an instance with the image **Ubuntu 24.04** and shape **VM.Standard.A1.Flex**, set to 2 OCPU and 12 GB. Download the SSH key.
2. **Oracle network:** go to Networking → your VCN → Security Lists → Default. Add ingress rules for TCP 80 and TCP 443 from `0.0.0.0/0`.
3. **GoDaddy DNS:** add two **A** records, `nexus` and `mediconsult`, both pointing to the instance's public IP.
4. **On the server:**
   ```bash
   ssh -i key.pem ubuntu@<public-ip>
   curl -fsSL https://raw.githubusercontent.com/fascEarth/nexus-core/main/deploy/server/setup.sh | bash -s -- you@email.com
   ```
   This installs Docker, opens the firewall, clones both repos, generates all secrets into `.env` (chmod 600), builds, starts, and schedules a nightly demo reset.

## Day to day

```bash
cd /opt/fascinora/nexus-core/deploy/server
./update.sh                      # pull latest code and redeploy
sudo docker compose ps           # status
sudo docker compose logs -f medi-api
./reset.sh                       # wipe demo data now
```

## Security notes
- Only ports 80/443 are exposed. Databases and Redis are reachable only inside the Docker network.
- Secrets are generated on the server and never committed. Back up `.env`; without `MEDI_DATA_ENCRYPTION_KEY`, encrypted records can't be read.
- MediConsult runs with `DEMO_MODE=true` and `PAYMENT_PROVIDER=demo`, so no real money moves. The API refuses demo mode with a real payment provider in production.
- Nexus API connects as `nexus_app`, so row-level security is enforced.
- Demo data is wiped nightly at 03:30 server time.
- If the repos are private, clone with a GitHub fine-grained token that has read-only access.
