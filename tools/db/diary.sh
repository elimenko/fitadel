#!/usr/bin/env bash
# Provisions the diary database and roles (see diary.psql). Idempotent.
#
# A fresh volume runs it automatically from /docker-entrypoint-initdb.d.
# For an existing volume, run it once by hand:
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/diary.sh

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$DIARY_MIGRATOR_PASSWORD" \
  -v app_password="$DIARY_APP_PASSWORD" \
  -v reader_password="$DIARY_READER_PASSWORD" \
  -f "$(dirname "${BASH_SOURCE[0]}")/diary.psql"
