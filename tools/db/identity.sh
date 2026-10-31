#!/usr/bin/env bash
# Provisions the identity database and roles (see identity.psql). Idempotent.
#
# A fresh volume runs it automatically from /docker-entrypoint-initdb.d.
# For an existing volume, run it once by hand:
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/identity.sh

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$IDENTITY_MIGRATOR_PASSWORD" \
  -v app_password="$IDENTITY_APP_PASSWORD" \
  -v reader_password="$IDENTITY_READER_PASSWORD" \
  -f "$(dirname "${BASH_SOURCE[0]}")/identity.psql"
