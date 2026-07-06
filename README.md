# VAPTBOOSTER

Multi-tenant SaaS pentest platform — Next.js frontend + worker + LiteLLM gateway.

## Architecture summary

```
Tenant browser  ──┐
                  ├─▶  Next.js  ──▶  Postgres (RLS-isolated)
Operator browser ─┘                  Redis (BullMQ queue)
                                     │
                                     ▼
                                  Worker  ──▶  LiteLLM proxy  ──▶  LLM providers
                                                (per-tenant
                                                 virtual keys,
                                                 cost tracking)
```

Every layer is hardened against the same failure: leaking one tenant's data to another.
- **App level**: NextAuth + middleware resolve tenant from subdomain
- **DB level**: Row-Level Security — Postgres physically refuses cross-tenant reads
- **LLM level**: Per-tenant LiteLLM virtual keys with budgets

## Quick start

```bash
# 1. Spin up Postgres + Redis + LiteLLM
docker compose up -d

# 2. Set up env vars
cp .env.example .env
# Edit .env — add real provider keys (ANTHROPIC_API_KEY, etc.)

# 3. Run Prisma migrations + RLS policies
npm install
npm run db:migrate
npm run db:rls
npm run db:seed

# 4. Provision a LiteLLM virtual key for the demo tenant
npm run tenant:provision-key acme

# 5. Start the Next.js app
npm run dev

# 6. (separate terminal) Start the scan worker
cd worker && npm install && npm run dev
```

Open http://localhost:3000 — root redirects to /dashboard.

## What's in this repo

```
app/                        Next.js App Router
  (auth)/login              Auth screens
  (tenant)/                 Tenant dashboard (sidebar shell)
    dashboard
    scans
    scans/[id]              Scan detail with live log
    findings
  (operator)/               Operator panel (cross-tenant)
    operator
    operator/usage          ⭐ Cost & margin dashboard
    operator/skills         ⭐ Skill catalog (super-admin)
    operator/skills/[key]   ⭐ Skill editor — prompts, payloads, parameters
    operator/agent-config   ⭐ Strategic planner config

components/
  ui/                       Design system (Button, Badge, Panel, Stat...)
  layout/                   Sidebar, Topbar

lib/
  db.ts                     ⭐ Tenant-aware Prisma wrapper (withTenant, withOperator)
  fonts.ts                  next/font loader
  mock-data.ts              Mock tenants/scans/findings
  mock-usage.ts             ⭐ Mock usage records (for the cost dashboard)
  mock-skills.ts            ⭐ Mock skills + agent config (for super-admin UI)
  utils.ts                  cn, timeAgo, hexId

prisma/
  schema.prisma             ⭐ All models
  migrations/
    001_init/               Run by `prisma migrate dev`
    002_rls/migration.sql   ⭐ Row-Level Security policies (run manually)
  seed.ts                   Demo data

infra/
  postgres/init-multi-db.sh Creates app + litellm DBs
  litellm/config.yaml       ⭐ Model routing, pricing, budgets

worker/                     ⭐ Standalone Node service
  src/
    index.ts                BullMQ scan worker with ceiling enforcement
    llm.ts                  LiteLLM client wrapper
    logger.ts

scripts/
  provision-tenant-key.ts   Creates a LiteLLM virtual key for a tenant

docker-compose.yml          Postgres + Redis + LiteLLM
.env.example                Env template
```

## How the cost loop works

1. Operator approves a scan → row enqueued in BullMQ
2. Worker dequeues, sets scan status to `running`
3. For each agent step:
   - Worker calls `llmCall()` which goes through LiteLLM
   - LiteLLM enforces the tenant's virtual-key budget (monthly hard cap)
   - Returns response + computed cost
   - Worker writes a `usage_records` row (operation, tokens, cost)
   - Worker updates `scan.spentUsdCents`
   - **Per-scan ceiling check**: if `spent > ceiling` (default €25), pauses the scan and notifies operator
4. Scan completes → `tenant_budget.creditsUsedThisPeriod` incremented
5. Operator dashboard reads usage rollups → spots margin issues

## How tenant isolation works

### Layer 1: Middleware (Next.js)
Subdomain (`acme.vaptbooster.pwntrol.com`) → resolves tenant in middleware → injects into request context.

### Layer 2: Application code (Prisma wrapper)
Every query goes through `withTenant(tenantId, ...)` which opens a transaction and sets:
```sql
SET LOCAL app.current_tenant = '<tenant_id>';
SET LOCAL app.role = 'tenant_user';
```

### Layer 3: Row-Level Security (Postgres)
Every table policy reads `current_tenant_id()` and refuses to return non-matching rows. Even if app code has a bug, Postgres protects you.

Operators use `withOperator(...)` which sets `app.role = 'operator'` and bypasses tenant filtering. Audit-log every operator action.

## Useful commands

```bash
# Schema changes
npm run db:migrate              # Apply new migrations
npm run db:studio               # Visual DB browser

# Tenant lifecycle
npm run tenant:provision-key foo   # Create LiteLLM virtual key

# Worker
cd worker
npm run dev                     # Run scan worker with watch mode
npm run typecheck

# Direct DB access (as superuser, for RLS testing)
docker compose exec postgres psql -U vaptbooster vaptbooster
```

## Production-readiness checklist

- [ ] Replace dev secrets in `.env`
- [ ] Set up wildcard DNS for `*.vaptbooster.pwntrol.com`
- [ ] Move worker to a separate machine/container (not the same pod as the web app)
- [ ] Move LiteLLM virtual keys to a secrets manager (Vault / AWS Secrets / Doppler)
- [ ] Add Sentry/observability to both web + worker
- [ ] Set up nightly aggregator cron for `tenant_budgets`
- [ ] Configure backups (Postgres + Redis persistence)
- [ ] Set up Stripe billing for plan management
- [ ] Add Resend/SendGrid templates for invitations + scan notifications
