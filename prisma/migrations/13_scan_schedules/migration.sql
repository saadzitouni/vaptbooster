-- Scan schedules — tenant-defined recurring scans. Idempotent.

CREATE TABLE IF NOT EXISTS "scan_schedules" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "targetId"    TEXT NOT NULL,
  "targetValue" TEXT NOT NULL,
  "frequency"   TEXT NOT NULL,
  "hour"        INTEGER NOT NULL,
  "minute"      INTEGER NOT NULL,
  "dayOfWeek"   INTEGER,
  "dayOfMonth"  INTEGER,
  "timezone"    TEXT NOT NULL DEFAULT 'UTC',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "notes"       TEXT,
  "credentials" TEXT,
  "nextRunAt"   TIMESTAMP(3) NOT NULL,
  "lastRunAt"   TIMESTAMP(3),
  "lastScanId"  TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scan_schedules_tenantId_idx" ON "scan_schedules"("tenantId");
CREATE INDEX IF NOT EXISTS "scan_schedules_active_nextRunAt_idx" ON "scan_schedules"("active","nextRunAt");

-- Foreign keys (guarded — ADD CONSTRAINT has no IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "scope_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- RLS — tenant isolation (operators bypass), matching the other tenant tables.
ALTER TABLE "scan_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scan_schedules" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scan_schedules_tenant_isolation ON "scan_schedules";
CREATE POLICY scan_schedules_tenant_isolation ON "scan_schedules"
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- Explicit grant to the low-priv app role (belt-and-suspenders).
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "scan_schedules" TO vaptbooster_app;
EXCEPTION WHEN undefined_object THEN null; END $$;
