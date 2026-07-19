-- Reasoning events — the live per-scan reasoning stream. Idempotent.

-- Enum (CREATE TYPE has no IF NOT EXISTS — guard it).
DO $$ BEGIN
  CREATE TYPE "ReasoningEventType" AS ENUM (
    'PHASE','OBSERVATION','INVARIANT','HYPOTHESIS','TEST',
    'RESULT','BLAST_RADIUS','HUMAN_HANDOFF','VERIFICATION','FINDING'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "reasoning_events" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "scanId"    TEXT NOT NULL,
  "seq"       INTEGER NOT NULL,
  "type"      "ReasoningEventType" NOT NULL,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reasoning_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reasoning_events_scanId_seq_key" ON "reasoning_events"("scanId","seq");
CREATE INDEX IF NOT EXISTS "reasoning_events_tenantId_scanId_idx" ON "reasoning_events"("tenantId","scanId");

-- Foreign keys (guarded — ADD CONSTRAINT has no IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE "reasoning_events" ADD CONSTRAINT "reasoning_events_scanId_fkey"
    FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "reasoning_events" ADD CONSTRAINT "reasoning_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- RLS — tenant isolation (operators bypass), matching the other tenant tables.
ALTER TABLE "reasoning_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reasoning_events" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reasoning_events_tenant_isolation ON "reasoning_events";
CREATE POLICY reasoning_events_tenant_isolation ON "reasoning_events"
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- Explicit grant to the low-priv app role (belt-and-suspenders).
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "reasoning_events" TO vaptbooster_app;
EXCEPTION WHEN undefined_object THEN null; END $$;
