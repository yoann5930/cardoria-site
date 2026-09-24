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

POSTGRES_STAGE="$STAGING_DIR/cardoria-postgres-$STAMP.dump"
DATA_STAGE="$STAGING_DIR/cardoria-data-$STAMP.tar.gz"
POSTGRES_FINAL="$BACKUP_DIR/cardoria-postgres-$STAMP.dump"
DATA_FINAL="$BACKUP_DIR/cardoria-data-$STAMP.tar.gz"

prune_backups() {
  python3 - "$BACKUP_DIR" <<'PY'
import os
import re
import sys
from collections import defaultdict

root = os.path.abspath(sys.argv[1])
pattern = re.compile(r'^cardoria-(postgres|data)-(\d{8}T\d{6}Z)\.(dump|tar\.gz)if [ -z "${MARKETPLACE_DATABASE_URL:-}" ]; then
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

prune_backups
find "$BACKUP_DIR" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
)
groups = defaultdict(dict)

for name in os.listdir(root):
    match = pattern.match(name)
    if not match:
        continue
    kind, stamp, _ext = match.groups()
    groups[stamp][kind] = os.path.join(root, name)

complete = sorted(
    (stamp for stamp, files in groups.items() if {'postgres', 'data'} <= files.keys()),
    reverse=True,
)

keep = set(complete[:12])
seen_days = set()
for stamp in complete:
    day = stamp[:8]
    if day not in seen_days and len(seen_days) < 7:
        keep.add(stamp)
        seen_days.add(day)

removed = 0
for stamp, files in groups.items():
    if stamp in keep:
        continue
    for path in files.values():
        try:
            os.remove(path)
            removed += 1
        except FileNotFoundError:
            pass

print(f"backup_retention_complete_sets: {len(complete)}")
print(f"backup_retention_kept_sets: {len(keep)}")
print(f"backup_retention_files_removed: {removed}")
PY
}

# Prune before staging a new archive so frequent deployments cannot exhaust disk.
prune_backups

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

find "$BACKUP_DIR" -type f -mtime +14 -delete
find "$BACKUP_DIR" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
