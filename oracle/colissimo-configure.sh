#!/usr/bin/env bash
# Secure Colissimo / La Poste API-key installer for Cardoria OVH.
# Reads COLISSIMO_API_KEY from stdin. Never accepts secrets in argv.
# Never creates a paid shipping label.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "colissimo-configure must run as root via sudoers"
  exit 1
fi

ENV_FILE=/etc/cardoria/cardoria.env

IFS= read -r api_key || true
api_key=${api_key%$'\r'}

valid_secret() {
  local value=${1:-}
  if [ -z "$value" ] || [ "${#value}" -lt 16 ] || [ "${#value}" -gt 512 ]; then
    return 1
  fi
  if printf '%s' "$value" | grep -q $'[\r\n]'; then
    return 1
  fi
  return 0
}

if ! valid_secret "$api_key"; then
  echo "colissimo_secret_input: invalid"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "env_file: missing"
  exit 1
fi

backup=$(mktemp)
tmp=$(mktemp)
cp "$ENV_FILE" "$backup"
trap 'rm -f "$backup" "$tmp"' EXIT

awk -F= '
  $1 != "COLISSIMO_API_KEY" &&
  $1 != "COLISSIMO_API_BASE" &&
  $1 != "COLISSIMO_PRODUCT_CODE" &&
  $1 != "COLISSIMO_LABEL_FORMAT" &&
  $1 != "COLISSIMO_LIVE_LABELS_ENABLED"
' "$ENV_FILE" > "$tmp"

{
  printf '%s=%s\n' 'COLISSIMO_API_KEY' "$api_key"
  printf '%s\n' 'COLISSIMO_API_BASE=https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1'
  printf '%s\n' 'COLISSIMO_PRODUCT_CODE=DOM'
  printf '%s\n' 'COLISSIMO_LABEL_FORMAT=PDF_10x15_300dpi'
  printf '%s\n' 'COLISSIMO_LIVE_LABELS_ENABLED=false'
} >> "$tmp"

install -m 0600 -o root -g root "$tmp" "$ENV_FILE"
unset api_key

systemctl restart cardoria

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:10000/api/health/ >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 45 ]; then
    install -m 0600 -o root -g root "$backup" "$ENV_FILE"
    systemctl restart cardoria
    echo "colissimo_configure: rollback"
    exit 1
  fi
  sleep 2
done

status_json=$(curl -fsS http://127.0.0.1:10000/api/colissimo/status)
STATUS_JSON="$status_json" node --input-type=module <<'NODE'
const data = JSON.parse(process.env.STATUS_JSON || "{}");
if (data.ok !== true) throw new Error("status endpoint failed");
if (data.provider !== "colissimo_direct") throw new Error("unexpected Colissimo provider");
if (data.configured !== true) throw new Error("Colissimo API key not loaded");
if (data.labelPurchasesEnabled !== false) throw new Error("label purchases must remain disabled");
if (String(data.apiBase || "").includes("localhost")) throw new Error("invalid Colissimo API base");
console.log("colissimo_process_config: ok");
console.log("colissimo_sender:", data.senderConfigured === true ? "configured" : "missing");
NODE

echo "colissimo_env: installed"
echo "colissimo_label_purchases: disabled"
echo "COLISSIMO CONFIGURE OK"
