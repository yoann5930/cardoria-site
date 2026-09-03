#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

DB_NAME=${CARDORIA_DB_NAME:-cardoria}
DB_USER=${CARDORIA_DB_USER:-cardoria}
DB_PASSWORD=${CARDORIA_DB_PASSWORD:-}

if [ -z "$DB_PASSWORD" ]; then
  echo "Set CARDORIA_DB_PASSWORD before running"
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /etc/postgresql/*/main/postgresql.conf
systemctl restart postgresql

echo "PostgreSQL ready on localhost only"
