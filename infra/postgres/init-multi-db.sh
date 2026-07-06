#!/bin/bash
# Create multiple databases in postgres at startup.
# Used by docker-entrypoint-initdb.d.

set -e
set -u

function create_db() {
  local db=$1
  echo "  · creating database '$db'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE $db;
    GRANT ALL PRIVILEGES ON DATABASE $db TO $POSTGRES_USER;
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
  echo "Creating additional databases: $POSTGRES_MULTIPLE_DATABASES"
  for db in $(echo $POSTGRES_MULTIPLE_DATABASES | tr ',' ' '); do
    # Skip the default db (already created by postgres entrypoint)
    if [ "$db" != "$POSTGRES_USER" ]; then
      create_db $db
    fi
  done
fi
