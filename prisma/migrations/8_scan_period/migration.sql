-- Separate the scan-quota window from the billing/cost window so resetting a
-- tenant's scan allotment doesn't wipe cost tracking (which scopes to
-- currentPeriodStart). Nullable — falls back to currentPeriodStart. Idempotent.
ALTER TABLE "tenant_budgets" ADD COLUMN IF NOT EXISTS "scanPeriodStart" TIMESTAMP(3);
