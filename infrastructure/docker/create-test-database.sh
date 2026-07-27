#!/bin/sh
set -eu

test_database="${POSTGRES_TEST_DB:-washqueue_test}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=test_database="$test_database" \
  --set=database_owner="$POSTGRES_USER" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'test_database', :'database_owner')
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = :'test_database'
)
\gexec
SQL
