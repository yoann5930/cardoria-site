#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/cardoria/current
BRANCH=${CARDORIA_BRANCH:-main}

cd "$APP_DIR"
PREV=$(git rev-parse HEAD 2>/dev/null || true)
[ -n "$PREV" ] && echo "$PREV" | sudo tee /opt/cardoria/previous-commit >/dev/null

git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

cd backend
npm install --omit=dev
node --check server.js

sudo systemctl daemon-reload
sudo systemctl restart cardoria

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:10000/api/health/ >/tmp/cardoria-health.json 2>/dev/null; then
    cat /tmp/cardoria-health.json
    echo "Deploy OK"
    exit 0
  fi
  sleep 2
done

echo "Healthcheck failed. Rolling back."
sudo bash "$APP_DIR/oracle/rollback.sh"
exit 1
