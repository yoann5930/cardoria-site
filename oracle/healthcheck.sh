#!/usr/bin/env bash
set -euo pipefail
BASE=${1:-http://127.0.0.1:10000}

check() {
  local path=$1
  local expected=${2:-200}
  local code
  local out
  out=$(mktemp)
  code=$(curl -sS -o "$out" -w '%{http_code}' "$BASE$path")
  if [ "$code" != "$expected" ]; then
    echo "FAIL $path HTTP $code expected $expected"
    cat "$out" || true
    rm -f "$out"
    exit 1
  fi
  rm -f "$out"
  echo "OK $path HTTP $code"
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
