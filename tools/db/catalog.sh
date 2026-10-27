#!/usr/bin/env bash
# Provisions the catalog database and roles (see catalog.psql). Idempotent.
#
# A fresh volume runs it automatically from /docker-entrypoint-initdb.d.
# For an existing volume, run it once by hand:
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/catalog.sh

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$CATALOG_MIGRATOR_PASSWORD" \
  -v app_password="$CATALOG_APP_PASSWORD" \
  -f "$(dirname "${BASH_SOURCE[0]}")/catalog.psql"
