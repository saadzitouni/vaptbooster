-- Per-tenant per-scan cost cap. Null → the plan default (lib/plans.ts). Applied
-- to scans.ceilingUsdCents at request time. Nullable, idempotent.
ALTER TABLE "tenant_budgets" ADD COLUMN IF NOT EXISTS "scanCeilingUsdCents" INTEGER;
