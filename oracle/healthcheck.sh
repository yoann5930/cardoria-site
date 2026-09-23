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

check_plans() {
  local path=/api/marketplace/v1/plans
  check "$path" 200
  grep -Fq '"id":"starter"' "$OUT"
  grep -Fq '"monthlyPriceEur":19.9' "$OUT"
  grep -Fq '"liveCommissionRate":0.06' "$OUT"
  grep -Fq '"id":"pro"' "$OUT"
  grep -Fq '"monthlyPriceEur":49.9' "$OUT"
  grep -Fq '"liveCommissionRate":0.045' "$OUT"
  grep -Fq '"liveCardoriaShippingBuyerLimit":6' "$OUT"
  grep -Fq '"id":"elite"' "$OUT"
  grep -Fq '"monthlyPriceEur":129.9' "$OUT"
  grep -Fq '"liveCommissionRate":0.03' "$OUT"
  grep -Fq '"liveCardoriaShippingBuyerLimit":15' "$OUT"
  grep -Fq '"marketplaceFreeCapturedSalesPerMonth":15' "$OUT"
  grep -Fq '"livePriority":true' "$OUT"
  grep -Fq '"badge":true' "$OUT"
  echo "OK $path canonical Starter/Pro/Elite"
}

check_live_public_chat() {
  local headers
  check /live.html 200
  grep -Fq 'cardoria-live-actions.js?v=20260923-live-directory' "$OUT"

  headers=$(curl -sSI "$BASE/live.html" | tr -d '\r')
  printf '%s\n' "$headers" | grep -qi '^Cache-Control: .*no-store'

  check /js/cardoria-live-actions.js 200
  grep -Fq 'live-chat-dock' "$OUT"
  if grep -Fq 'id="claName"' "$OUT"; then
    echo "FAIL legacy Live chat name field is still served"
    exit 1
  fi

  check /js/cardoria-live-viewer.js 200
  headers=$(curl -sSI "$BASE/js/cardoria-live-viewer.js" | tr -d '\r')
  printf '%s\n' "$headers" | grep -qi '^Cache-Control: .*no-store'
  if grep -Fq 'Aucune caméra disponible.' "$OUT"; then
    echo "FAIL public viewer still fatals when no camera is published"
    exit 1
  fi

  check /client-login.html 200
  grep -Fq 'client-auth.js?v=20260923-live-public-journey' "$OUT"

  check /admin-live.html 200
  grep -Fq 'admin-live.js?v=20260923-live-public-journey' "$OUT"
  check /js/admin/admin-live.js 200
  grep -Fq 'Ouvrir le Live public' "$OUT"
  grep -Fq 'window.open(liveUrl, "_blank", "noopener")' "$OUT"
  if grep -Fq 'window.open("about:blank", "_blank")' "$OUT"; then
    echo "FAIL legacy async public Live opener is still served"
    exit 1
  fi
  if grep -Fq 'Voir comme spectateur' "$OUT"; then
    echo "FAIL legacy spectator button label is still served"
    exit 1
  fi

  echo "OK Live public chat/cache/open build"
}

check / 200
check /boutique.html 200
check /marketplace.html 200
check /estimation.html 200
check /scanner.html 200
check /robots.txt 200
check /sitemap.xml 200
check /admin-login.html 200
check_live_public_chat
check /api/health/ 200
check /api/health/startup 200
check /api/payments/boutique/products 200
check '/api/marketplace/v1/search?license=pokemon' 200
check_plans
check /api/admin/dashboard 401

echo "Cardoria smoke tests OK"
