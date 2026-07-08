-- In-app notifications / messages, per recipient user.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tenantId"  TEXT,
  "type"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "link"      TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_userId_readAt_idx"   ON "notifications"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS: operators see all; tenant users see their tenant's rows (queries also
-- filter by userId). Mirrors the tenant-isolation policy on other tables.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
CREATE POLICY notifications_tenant_isolation ON notifications
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );
