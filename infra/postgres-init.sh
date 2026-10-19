#!/bin/sh
(
# Keep flags/local assignments inside this subshell if the image sources the file.
set -eu
NUVEX_DATABASE_NAME=${NUVEX_DATABASE_NAME:-nuvex}

# This script is sourced by the official PostgreSQL entrypoint on a fresh volume.
# The API role owns its database, but has no cluster administration permissions.
case "${NUVEX_DATABASE_PASSWORD:-}" in
  ''|*[!0-9a-fA-F]*) echo 'NUVEX_DATABASE_PASSWORD must contain only hexadecimal characters.' >&2; exit 1 ;;
esac
if [ "${#NUVEX_DATABASE_PASSWORD}" -lt 64 ]; then
  echo 'NUVEX_DATABASE_PASSWORD must contain at least 64 hexadecimal characters.' >&2
  exit 1
fi
case "${NUVEX_DATABASE_NAME:-nuvex}" in
  ''|*[!a-z0-9_]*|[0-9_]*|postgres|template0|template1) echo 'Invalid NUVEX_DATABASE_NAME.' >&2; exit 1 ;;
esac
if [ "${#NUVEX_DATABASE_NAME}" -gt 63 ]; then
  echo 'NUVEX_DATABASE_NAME exceeds PostgreSQL identifier length.' >&2
  exit 1
fi

psql --username "$POSTGRES_USER" --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --set app_password="$NUVEX_DATABASE_PASSWORD" \
  --set app_database="$NUVEX_DATABASE_NAME" <<'SQL'
CREATE ROLE nuvex LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE :"app_database" OWNER nuvex;
REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC;
SQL
)
