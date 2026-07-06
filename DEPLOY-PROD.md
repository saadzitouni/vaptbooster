# VAPTBOOSTER — Production Deployment (with the autonomous agent)

Go-live runbook for a single VPS + domain, shipping the **autonomous agent**.
Execute top-to-bottom. `$` = run on the server.

---

## Architecture in prod

```
            Internet
               │ 443 (only public port)
               ▼
        ┌──── Caddy (auto-TLS) ────┐         docker compose (control plane)
        │  app.YOURDOMAIN          │         ─────────────────────────────
        └──────────┬───────────────┘         web · postgres · redis ·
                   │                          litellm · db-init · caddy
                   ▼                          (postgres+litellm also bound
              web (Next.js)                    to 127.0.0.1 for the runner)
                   │
   ── host (native Docker) ───────────────────────────────────────────────
   autonomous runner  ──launches──►  ephemeral egress-locked sandbox / scan
   (operator-triggered)              (iptables allowlist = ONLY the target)
```

**Why the runner runs on the host, not in a container:** it must launch Docker
sandboxes. Mounting the Docker socket into an internet-adjacent container = host
root. Keeping the runner on the host (and the web tier with **no** Docker access)
is the safe MVP. Hardening upgrade later: a dedicated sandbox-runner VM.

---

## 0. Prerequisites
- VPS: **4 vCПU / 8 GB RAM / 40 GB** min (LLM gateway + sandboxes). Ubuntu 22.04+.
- A domain you control (e.g. `vaptbooster.com`) with DNS access.
- Docker + Docker Compose v2, Node 22, git on the server.

```
$ curl -fsSL https://get.docker.com | sh
$ curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
$ sudo ufw allow 22,80,443/tcp && sudo ufw enable      # ONLY 22/80/443 public
```

## 1. 🔴 Rotate ALL secrets (blocking)
The Anthropic + OpenRouter keys used in development are compromised (they were
shared in chat). Before prod:
- **OpenRouter**: openrouter.ai → delete the old key, create a new one.
- **Anthropic**: console.anthropic.com → delete the old key (if used).
- Generate fresh internal secrets:
```
$ openssl rand -hex 32   # AUTH_SECRET
$ openssl rand -hex 32   # POSTGRES_PASSWORD
$ openssl rand -hex 32   # REDIS_PASSWORD
$ echo "sk-master-$(openssl rand -hex 24)"   # LITELLM_MASTER_KEY
```

## 2. Clone + configure
```
$ git clone <your repo> vaptbooster && cd vaptbooster
$ cp .env.production.example .env
$ nano .env
```
Fill in: `PUBLIC_DOMAIN=app.YOURDOMAIN`, the rotated secrets above, and
`OPENROUTER_API_KEY=<new key>`. Keep `SIMULATE_LLM` unset/false.
Confirm `.env` and `.secrets/` are gitignored (they are).

## 3. DNS + TLS
Point DNS at the server, then Caddy issues TLS automatically on first boot:
```
A     app.YOURDOMAIN       → <server IP>
A     *.YOURDOMAIN         → <server IP>     # tenant subdomains (optional)
```

## 4. Build images (incl. the sandbox)
```
$ docker compose -f docker-compose.prod.yml build          # web, worker, migrate
$ docker build -t vaptbooster-agent-sandbox:latest ./agent-sandbox   # the agent sandbox
```

## 5. Bring up the control plane
`db-init` runs migrations + creates the low-priv RLS role, then web/litellm/caddy start.
```
$ docker compose -f docker-compose.prod.yml up -d
$ docker compose -f docker-compose.prod.yml logs -f db-init   # watch it migrate, then Ctrl-C
$ curl -s https://app.YOURDOMAIN/api/health                    # {"status":"ok"}
```

## 6. Expose infra to the host — 127.0.0.1 only (for the runner + admin scripts)
Create `docker-compose.runner.yml`:
```yaml
services:
  postgres: { ports: ["127.0.0.1:5432:5432"] }
  litellm:  { ports: ["127.0.0.1:4000:4000"] }
```
```
$ docker compose -f docker-compose.prod.yml -f docker-compose.runner.yml up -d
```
Localhost-only bindings — the firewall keeps them off the internet.

## 7. Install host deps (for the runner + admin scripts)
Use `npm install`, not `npm ci` — the committed lockfile omits Linux-only
optional deps, which `npm ci` (strict) rejects on a Linux host.
```
$ npm install && npx prisma generate     # root — for scripts/*
$ ( cd worker && npm install )            # worker — for the runner
$ export OWNER_DB="postgresql://vaptbooster:<POSTGRES_PASSWORD>@127.0.0.1:5432/vaptbooster"
```

## 8. Create your operator login
```
$ DATABASE_URL="$OWNER_DB" OPERATOR_EMAIL=you@co.com OPERATOR_PASSWORD='<strong 12+ chars>' \
    npx tsx scripts/create-operator.ts
```
Log in at `https://app.YOURDOMAIN`.

## 9. Onboard your first client
1. **Authorization first** (see Legal below) — signed engagement + RoE + scope.
2. Create the tenant + member:
```
$ DATABASE_URL="$OWNER_DB" npx tsx scripts/create-tenant.ts acme "Acme Corp" user@acme.com '<pw>' solo
```
3. Provision their metered LiteLLM key:
```
$ DATABASE_URL="$OWNER_DB" LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MASTER_KEY=<key> \
    npx tsx scripts/provision-tenant-key.ts acme
```
4. Client logs in → **Scope** → adds target → verifies via **DNS-TXT** (their proof of ownership = your authorization gate).

## 10. Run an autonomous engagement (operator-triggered)
For an approved + **verified** target:
```
$ cd worker
$ DATABASE_URL="$OWNER_DB" LITELLM_BASE_URL="http://127.0.0.1:4000" \
  LITELLM_KEYS_FILE="$(cd .. && pwd)/.secrets/litellm-keys.json" \
  npx tsx src/autonomous/runner.ts acme https://target --budget=10
```
The client watches live at `https://app.YOURDOMAIN/scans/<id>`; findings land in the UI.

---

## 🔒 Security hardening checklist
- [ ] Only 22/80/443 public (ufw). Postgres/redis/litellm are 127.0.0.1 or internal only.
- [ ] All secrets rotated; `.env`/`.secrets/` never committed.
- [ ] Web tier has **no** Docker access. Runner on host (or dedicated sandbox VM later).
- [ ] Egress lock verified: sandbox reaches ONLY the target (test: it can't curl example.com).
- [ ] Per-tenant budget hard-caps set in LiteLLM; alert on spend. Runner `--budget` per scan.
- [ ] Backups scheduled: `scripts/backup-db.sh` via cron.
- [ ] Error tracking: set `SENTRY_DSN` in `.env`.
- [ ] SSH key-only auth; fail2ban.

## ⚖️ Legal / authorization (non-negotiable for a pentest business)
The scope-verification gate is the *technical* control. You also need the *paper*:
- A signed **engagement agreement** + **Rules of Engagement** (targets, windows, exclusions,
  no-DoS, data handling) **per client, before any scan**.
- Store the signed authorization; tie it to the tenant. This is what makes automated
  exploitation lawful and protects you.

## Known gaps to close after first client
- **Operator approval queue UI** — currently CLI/host-triggered; wire the Approve button
  to auto-launch the runner for self-serve.
- **Dedicated sandbox host** — move the runner off the app VPS for stronger isolation.
- **Billing** — LiteLLM meters cost per tenant; add invoicing (Stripe) when you charge.
