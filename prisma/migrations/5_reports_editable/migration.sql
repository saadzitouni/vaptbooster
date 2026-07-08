-- Reshape "reports" from a scan-generated PDF stub into an editable
-- engagement document. Idempotent (safe to re-run / partial-apply), matching
-- the style of migrations 2–4.

-- 1) Legacy required columns become optional -----------------------------
ALTER TABLE "reports" ALTER COLUMN "scanId" DROP NOT NULL;
ALTER TABLE "reports" ALTER COLUMN "s3Key"  DROP NOT NULL;

-- 2) Loosen the scan FK from CASCADE to SET NULL so deleting a scan keeps
--    any reports that referenced it.
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_scanId_fkey";
DO $$ BEGIN
  ALTER TABLE "reports"
    ADD CONSTRAINT "reports_scanId_fkey"
    FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) New editable document columns --------------------------------------
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "createdById"       TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "createdByRole"     TEXT NOT NULL DEFAULT 'tenant';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "title"             TEXT NOT NULL DEFAULT 'Security Assessment Report';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "clientName"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "clientTagline"     TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "engagementRef"     TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "preparedBy"        TEXT NOT NULL DEFAULT 'PWNTROL';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "logoDataUrl"       TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "executiveSummary"  TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "scopeText"         TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "methodology"       TEXT;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "findings"          JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "status"            TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "confidential"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `format` (default 'pdf') and `generatedAt` already exist from 0_init.
-- RLS policy reports_tenant_isolation (1_rls) already covers all columns.
