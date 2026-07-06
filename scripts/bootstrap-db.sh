#!/bin/sh
# =============================================================
# DB bootstrap — run once on deploy (db-init service).
# Requires (owner/superuser) DATABASE_URL + APP_DB_PASSWORD.
# Set SEED_ON_INIT=true to load demo data.
# =============================================================
set -eu

echo "[bootstrap] waiting for Postgres..."
until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; do sleep 1; done

echo "[bootstrap] applying migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[bootstrap] ensuring low-privilege app role (NOBYPASSRLS)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" \
  -f scripts/init-db-roles.sql

if [ "${SEED_ON_INIT:-false}" = "true" ]; then
  echo "[bootstrap] seeding demo data..."
  npx tsx prisma/seed.ts
fi

echo "[bootstrap] complete."
