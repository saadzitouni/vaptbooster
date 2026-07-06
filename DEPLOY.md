# Deploying VAPTBOOSTER

Production stack: **Caddy** (TLS + tenant subdomain routing) → **Next.js web** + **scan worker** → **Postgres** (RLS-isolated) + **Redis** (BullMQ) + **LiteLLM** (per-tenant cost control). Everything runs from [docker-compose.prod.yml](docker-compose.prod.yml); only Caddy is exposed to the internet.

## Prerequisites
- A host with Docker + Docker Compose.
- DNS: `A`/`AAAA` records for `ROOT_DOMAIN` **and** `*.ROOT_DOMAIN` pointing at the host.
- Ports 80 + 443 open.

## 1. Configure secrets
```bash
cp .env.production.example .env.production
# fill in every required value; generate strong secrets:
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 24      # POSTGRES_PASSWORD / APP_DB_PASSWORD / REDIS_PASSWORD
```
The stack is **fail-closed** — it won't start if a required secret is missing.

## 2. First deploy
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
On boot, the one-shot **`db-init`** service:
1. runs `prisma migrate deploy` (schema → RLS),
2. creates the low-privilege `vaptbooster_app` role (`NOBYPASSRLS`),
3. seeds sample data if `SEED_ON_INIT=true`.

The **web** and **worker** connect with different DB roles: the app uses the low-privilege role (so RLS is enforced); the worker uses the owner (cross-tenant system service). Check health:
```bash
curl -fsS https://$ROOT_DOMAIN/api/health     # {"status":"ok","db":"up"}
docker compose -f docker-compose.prod.yml logs -f db-init web worker
```

## 3. Turn on real scans (per-tenant cost tracking)
Scans run in **simulate mode** (`SIMULATE_LLM=true`) until you provision LiteLLM virtual keys:
```bash
# provision a per-tenant virtual key (writes .secrets/litellm-keys.json, mounted read-only into the worker)
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://vaptbooster:$POSTGRES_PASSWORD@postgres:5432/vaptbooster" \
  -e LITELLM_MASTER_KEY="$LITELLM_MASTER_KEY" -e LITELLM_BASE_URL="http://litellm:4000" \
  db-init npx tsx scripts/provision-tenant-key.ts <tenant-slug>
```
Then set `SIMULATE_LLM=false` in `.env.production` and `docker compose ... up -d worker`.
> Secrets bridge is a file for now — move to a real secrets manager (Vault / AWS Secrets) before serious production.

## 4. Backups & maintenance
```bash
# nightly Postgres backup (cron on the host)
0 3 * * * cd /srv/vaptbooster && DATABASE_URL="postgresql://vaptbooster:PW@localhost:5432/vaptbooster" sh scripts/backup-db.sh
# monthly budget rollup (cron)
0 2 1 * * docker compose -f docker-compose.prod.yml exec -T worker sh -c 'DATABASE_URL=$DATABASE_URL npx tsx scripts/aggregate-budgets.ts'
```

## Notes / remaining hardening
- **Wildcard TLS** needs a DNS-01 challenge — add the Caddy DNS module for your provider and uncomment the `tls` block in [infra/caddy/Caddyfile](infra/caddy/Caddyfile). The apex cert works out of the box (HTTP-01).
- **Observability**: `npm i @sentry/nextjs` + set `SENTRY_DSN` (wired via [instrumentation.ts](instrumentation.ts)).
- **Worker DB role**: currently the owner (superuser). Tighten to a dedicated `BYPASSRLS` non-superuser role for least privilege.
- **S3 reports** (PDF export/evidence) are not yet implemented — a future feature slice.
