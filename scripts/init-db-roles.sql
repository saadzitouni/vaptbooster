-- =============================================================
-- Create the low-privilege application role for VAPTBOOSTER.
--
-- The app MUST connect as this role (NOT the owner/superuser) so that
-- Postgres Row-Level Security is enforced — superusers and table owners
-- bypass RLS even with FORCE ROW LEVEL SECURITY.
--
-- Run once, as the DB owner, passing the app password:
--   docker compose exec -T postgres \
--     psql -U vaptbooster -d vaptbooster -v app_password="$APP_DB_PASSWORD" \
--     < scripts/init-db-roles.sql
--
-- Idempotent — safe to re-run. The role is created NOBYPASSRLS on purpose.
-- =============================================================

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaptbooster_app') AS need_create \gset

\if :need_create
CREATE ROLE vaptbooster_app LOGIN NOBYPASSRLS PASSWORD :'app_password';
\else
ALTER ROLE vaptbooster_app LOGIN NOBYPASSRLS PASSWORD :'app_password';
\endif

GRANT CONNECT ON DATABASE vaptbooster TO vaptbooster_app;
GRANT USAGE ON SCHEMA public TO vaptbooster_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaptbooster_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vaptbooster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaptbooster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vaptbooster_app;

-- Sanity check: this role must NOT be a superuser and must NOT bypass RLS.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname = 'vaptbooster_app';
