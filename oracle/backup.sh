#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/opt/cardoria/backups
ENV_FILE=/etc/cardoria/cardoria.env
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ -n "${MARKETPLACE_DATABASE_URL:-}" ]; then
  pg_dump "$MARKETPLACE_DATABASE_URL" -Fc -f "$BACKUP_DIR/cardoria-postgres-$STAMP.dump"
fi

if [ -d /opt/cardoria/current/backend/data ]; then
  tar -czf "$BACKUP_DIR/cardoria-data-$STAMP.tar.gz" -C /opt/cardoria/current/backend data
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
find "$BACKUP_DIR" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
