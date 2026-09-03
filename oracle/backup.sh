#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/opt/cardoria/backups
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

if [ -n "${MARKETPLACE_DATABASE_URL:-}" ]; then
  pg_dump "$MARKETPLACE_DATABASE_URL" -Fc -f "$BACKUP_DIR/cardoria-postgres-$STAMP.dump"
fi

if [ -d "$DATA_DIR" ]; then
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

  tar -czf "$BACKUP_DIR/cardoria-data-$STAMP.tar.gz" -C "$STAGING_DIR" data
  tar -tzf "$BACKUP_DIR/cardoria-data-$STAMP.tar.gz" >/dev/null
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
find "$BACKUP_DIR" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
