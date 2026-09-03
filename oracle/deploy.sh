#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/cardoria/current
BRANCH=${CARDORIA_BRANCH:-main}

cd "$APP_DIR"
PREV=$(git rev-parse HEAD 2>/dev/null || true)
[ -n "$PREV" ] && echo "$PREV" | sudo tee /opt/cardoria/previous-commit >/dev/null

git fetch --all --prune
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

cd backend
npm install --omit=dev
node --check server.js

sudo systemctl daemon-reload
sudo systemctl restart cardoria

CHECK_LOG=$(mktemp)
trap 'rm -f "$CHECK_LOG"' EXIT
for i in $(seq 1 45); do
  if bash "$APP_DIR/oracle/healthcheck.sh" >"$CHECK_LOG" 2>&1; then
    cat "$CHECK_LOG"
    echo "Deploy OK"
    exit 0
  fi
  sleep 2
done

cat "$CHECK_LOG" || true
echo "Healthcheck failed. Rolling back."
sudo bash "$APP_DIR/oracle/rollback.sh"
exit 1
