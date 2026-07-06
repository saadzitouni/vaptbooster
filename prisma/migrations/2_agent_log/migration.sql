-- Live agent transcript (streamed to the scan page). This column was added
-- after 1_rls via a raw ALTER in dev; this migration brings migration-based
-- deployments (prod) in line with the Prisma schema.
--
-- Idempotent (IF NOT EXISTS) so it's safe where the column already exists.
-- Table-level grants to vaptbooster_app cover new columns automatically.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "agentLog" JSONB;
