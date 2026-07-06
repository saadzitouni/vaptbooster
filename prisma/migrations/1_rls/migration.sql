-- =============================================================
-- ROW-LEVEL SECURITY for VAPTBOOSTER
--
-- Why this exists:
--   Multi-tenant SaaS is one missed WHERE clause away from leaking
--   client A's findings to client B. Application code WILL eventually
--   forget that filter. RLS makes Postgres refuse to return rows that
--   don't belong to the current tenant — even when the query forgets.
--
-- How it works:
--   1. Every tenant-scoped table has a tenantId column.
--   2. Before any query in a request, the app sets:
--        SET LOCAL app.current_tenant = '<tenant_id>';
--        SET LOCAL app.role = 'tenant_user';  -- or 'operator'
--   3. RLS policies on each table read app.current_tenant and only
--      return rows where tenantId matches.
--   4. The "operator" role bypasses tenant filtering for cross-tenant
--      views, but its actions are audit-logged.
--
-- The app connects as a low-privilege "vaptbooster_app" role —
-- NEVER as superuser. RLS is bypassed for the postgres superuser.
-- =============================================================

-- ---------- Roles ----------
-- (Create these once, manually, when provisioning the DB:)
--
--   CREATE ROLE vaptbooster_app LOGIN PASSWORD '...';
--   GRANT CONNECT ON DATABASE vaptbooster TO vaptbooster_app;
--   GRANT USAGE ON SCHEMA public TO vaptbooster_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaptbooster_app;
--   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO vaptbooster_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaptbooster_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO vaptbooster_app;

-- ---------- Helper function ----------
-- Reads the per-transaction tenant context. Returns NULL when
-- nothing is set (e.g. during migrations) — we use that to allow
-- migrations to run without any tenant context.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_tenant', TRUE);
END;
$$ LANGUAGE plpgsql STABLE;

-- True when the current request is an operator (cross-tenant access).
CREATE OR REPLACE FUNCTION current_is_operator() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.role', TRUE) = 'operator', FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================
-- Apply RLS to every tenant-scoped table.
-- Pattern: USING + WITH CHECK ensure both reads and writes are
-- constrained to the current tenant. Operators bypass via the
-- current_is_operator() short-circuit.
-- =============================================================

-- ---------- scope_targets ----------
ALTER TABLE scope_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_targets FORCE  ROW LEVEL SECURITY;

CREATE POLICY scope_targets_tenant_isolation ON scope_targets
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- scans ----------
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans FORCE  ROW LEVEL SECURITY;

CREATE POLICY scans_tenant_isolation ON scans
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- findings ----------
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings FORCE  ROW LEVEL SECURITY;

CREATE POLICY findings_tenant_isolation ON findings
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- reports ----------
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE  ROW LEVEL SECURITY;

CREATE POLICY reports_tenant_isolation ON reports
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- usage_records ----------
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE  ROW LEVEL SECURITY;

CREATE POLICY usage_records_tenant_isolation ON usage_records
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- tenant_budgets ----------
ALTER TABLE tenant_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_budgets FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_budgets_tenant_isolation ON tenant_budgets
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- ---------- users ----------
-- Users are slightly different: an operator has tenantId = NULL.
-- Tenant members can only see other users in their own tenant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (
    current_is_operator()
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_is_operator()
    OR "tenantId" = current_tenant_id()
  );

-- ---------- invites ----------
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE  ROW LEVEL SECURITY;

CREATE POLICY invites_tenant_isolation ON invites
  USING ( current_is_operator() OR "tenantId" = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR "tenantId" = current_tenant_id() );

-- =============================================================
-- Tenants table itself: operators see all, members see only own.
-- =============================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON tenants
  USING ( current_is_operator() OR id = current_tenant_id() )
  WITH CHECK ( current_is_operator() OR id = current_tenant_id() );
