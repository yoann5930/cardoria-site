#!/usr/bin/env bash
set -euo pipefail
BASE=${1:-http://127.0.0.1:10000}
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

check() {
  local path=$1
  local expected=${2:-200}
  local code="000"
  local attempt

  for attempt in $(seq 1 30); do
    code=$(curl -sS -o "$OUT" -w '%{http_code}' "$BASE$path" || true)
    if [ "$code" = "$expected" ]; then
      echo "OK $path HTTP $code"
      return 0
    fi
    sleep 2
  done

  echo "FAIL $path HTTP $code expected $expected"
  cat "$OUT" || true
  exit 1
}

check / 200
check /boutique.html 200
check /marketplace.html 200
check /estimation.html 200
check /scanner.html 200
check /admin-login.html 200
check /api/health/ 200
check /api/health/startup 200
check /api/payments/boutique/products 200
check '/api/marketplace/v1/search?license=pokemon' 200
check /api/admin/dashboard 401

echo "Cardoria smoke tests OK"
