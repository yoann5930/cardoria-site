#!/usr/bin/env python3
import os
import re
import sys
from collections import defaultdict

root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/opt/cardoria/backups")
pattern = re.compile(r"^cardoria-(postgres|data)-(\d{8}T\d{6}Z)\.(dump|tar\.gz)$")
groups = defaultdict(dict)

if not os.path.isdir(root):
    print("backup_retention_root_missing:", root)
    raise SystemExit(1)

for name in os.listdir(root):
    match = pattern.match(name)
    if not match:
        continue
    kind, stamp, _ext = match.groups()
    groups[stamp][kind] = os.path.join(root, name)

complete = sorted(
    (stamp for stamp, files in groups.items() if {"postgres", "data"} <= files.keys()),
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

print("backup_retention_complete_sets:", len(complete))
print("backup_retention_kept_sets:", len(keep))
print("backup_retention_files_removed:", removed)
