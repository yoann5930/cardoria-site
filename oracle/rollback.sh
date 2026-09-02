#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/cardoria/current
PREV_FILE=/opt/cardoria/previous-commit

if [ ! -s "$PREV_FILE" ]; then
  echo "No previous commit recorded"
  exit 1
fi

PREV=$(cat "$PREV_FILE")
cd "$APP_DIR"
git fetch --all --prune
git reset --hard "$PREV"
cd backend
npm install --omit=dev
systemctl restart cardoria
sleep 3
curl -fsS http://127.0.0.1:10000/api/health/
echo
 echo "Rollback OK: $PREV"
