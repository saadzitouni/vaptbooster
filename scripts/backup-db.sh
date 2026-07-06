#!/bin/sh
# =============================================================
# Postgres backup with retention. Requires pg_dump + an owner
# DATABASE_URL. Run from cron on the host, e.g. daily at 03:00:
#   0 3 * * * cd /srv/vaptbooster && DATABASE_URL=... sh scripts/backup-db.sh
# Or inside the running stack:
#   docker compose -f docker-compose.prod.yml exec -T postgres \
#     sh -c 'pg_dump -U vaptbooster vaptbooster | gzip' > backups/db-$(date +%F).sql.gz
# =============================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

ts=$(date +%Y%m%d-%H%M%S)
out="$BACKUP_DIR/vaptbooster-$ts.sql.gz"

echo "[backup] dumping to $out"
pg_dump "${DATABASE_URL:?set DATABASE_URL (owner connection)}" | gzip > "$out"

echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'vaptbooster-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] done: $out"
