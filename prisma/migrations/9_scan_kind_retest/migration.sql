-- Retest / incremental-scan support. `kind` distinguishes a full assessment
-- from a scoped retest; `retestFindingIds` holds the Finding ids a retest
-- re-verifies. Both idempotent + backfilled with safe defaults.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'assessment';
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "retestFindingIds" TEXT[] NOT NULL DEFAULT '{}';
