#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/opt/cardoria/backups
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE=/etc/cardoria/cardoria.env
DATA_DIR=/opt/cardoria/current/backend/data
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STAGING_DIR=$(mktemp -d "/tmp/cardoria-backup-$STAMP-XXXXXX")
trap 'rm -rf "$STAGING_DIR"' EXIT

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

POSTGRES_STAGE="$STAGING_DIR/cardoria-postgres-$STAMP.dump"
DATA_STAGE="$STAGING_DIR/cardoria-data-$STAMP.tar.gz"
POSTGRES_FINAL="$BACKUP_DIR/cardoria-postgres-$STAMP.dump"
DATA_FINAL="$BACKUP_DIR/cardoria-data-$STAMP.tar.gz"

python3 "$SCRIPT_DIR/prune-backups.py" "$BACKUP_DIR"

if [ -z "${MARKETPLACE_DATABASE_URL:-}" ]; then
  echo "MARKETPLACE_DATABASE_URL missing"
  exit 1
fi

pg_dump "$MARKETPLACE_DATABASE_URL" -Fc -f "$POSTGRES_STAGE"
if [ ! -s "$POSTGRES_STAGE" ] || ! pg_restore -l "$POSTGRES_STAGE" >/dev/null 2>&1; then
  echo "PostgreSQL backup validation failed"
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "Data directory missing: $DATA_DIR"
  exit 1
fi

python3 - "$DATA_DIR" "$STAGING_DIR/data" <<'PY'
import os
import shutil
import sqlite3
import sys

src_root = os.path.abspath(sys.argv[1])
dst_root = os.path.abspath(sys.argv[2])
os.makedirs(dst_root, exist_ok=True)

sqlite_exts = {'.db', '.sqlite', '.sqlite3'}
sidecar_suffixes = ('-wal', '-shm', '-journal')

for current, dirs, files in os.walk(src_root):
    if os.path.abspath(current) == src_root:
        dirs[:] = [name for name in dirs if name != 'backups']

    rel = os.path.relpath(current, src_root)
    dst_dir = dst_root if rel == '.' else os.path.join(dst_root, rel)
    os.makedirs(dst_dir, exist_ok=True)

    for name in files:
        src = os.path.join(current, name)
        dst = os.path.join(dst_dir, name)
        lower = name.lower()

        if lower.endswith(sidecar_suffixes):
            continue

        ext = os.path.splitext(lower)[1]
        if ext in sqlite_exts:
            try:
                source = sqlite3.connect(f'file:{src}?mode=ro', uri=True, timeout=30)
                target = sqlite3.connect(dst)
                try:
                    source.backup(target)
                finally:
                    target.close()
                    source.close()
                shutil.copystat(src, dst, follow_symlinks=True)
                continue
            except sqlite3.DatabaseError:
                if os.path.exists(dst):
                    os.remove(dst)

        shutil.copy2(src, dst)
PY

tar -czf "$DATA_STAGE" -C "$STAGING_DIR" data
if [ ! -s "$DATA_STAGE" ] || ! tar -tzf "$DATA_STAGE" >/dev/null 2>&1; then
  echo "Data archive validation failed"
  exit 1
fi

# Publish only fully validated artifacts. A failed backup never becomes the
# newest file consumed by backup-check.
mv "$POSTGRES_STAGE" "$POSTGRES_FINAL"
mv "$DATA_STAGE" "$DATA_FINAL"

echo "postgres_dump_validated: $(basename "$POSTGRES_FINAL")"
echo "data_archive_validated: $(basename "$DATA_FINAL")"

python3 "$SCRIPT_DIR/prune-backups.py" "$BACKUP_DIR"
find "$BACKUP_DIR" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
