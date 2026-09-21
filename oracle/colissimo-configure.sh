#!/usr/bin/env bash
# Secure Colissimo / La Poste credential installer for Cardoria OVH.
# Reads contract number then password from stdin. Never accepts secrets in argv.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "colissimo-configure must run as root via sudoers"
  exit 1
fi

ENV_FILE=/etc/cardoria/cardoria.env

IFS= read -r contract_number || true
IFS= read -r password || true

valid_secret() {
  local value=${1:-}
  if [ -z "$value" ] || [ "${#value}" -gt 512 ]; then
    return 1
  fi
  if printf '%s' "$value" | grep -q $'[\r\n]'; then
    return 1
  fi
  return 0
}

if ! valid_secret "$contract_number" || ! valid_secret "$password"; then
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
  $1 != "COLISSIMO_CONTRACT_NUMBER" &&
  $1 != "COLISSIMO_PASSWORD" &&
  $1 != "COLISSIMO_PRODUCT_CODE" &&
  $1 != "COLISSIMO_OUTPUT_PRINTING_TYPE" &&
  $1 != "COLISSIMO_LABELS_ENABLED"
' "$ENV_FILE" > "$tmp"

{
  printf '%s=%s\n' 'COLISSIMO_CONTRACT_NUMBER' "$contract_number"
  printf '%s=%s\n' 'COLISSIMO_PASSWORD' "$password"
  printf '%s\n' 'COLISSIMO_PRODUCT_CODE=DOM'
  printf '%s\n' 'COLISSIMO_OUTPUT_PRINTING_TYPE=PDF_A4_300dpi'
  printf '%s\n' 'COLISSIMO_LABELS_ENABLED=false'
} >> "$tmp"

install -m 0600 -o root -g root "$tmp" "$ENV_FILE"
unset contract_number password

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

status_json=$(curl -fsS http://127.0.0.1:10000/api/laposte/status)
STATUS_JSON="$status_json" node --input-type=module <<'NODE'
const data = JSON.parse(process.env.STATUS_JSON || "{}");
if (data.ok !== true) throw new Error("status endpoint failed");
if (data.configured !== true) throw new Error("Colissimo configuration not loaded");
if (data.labelPurchasesEnabled !== false) throw new Error("label purchases must remain disabled");
console.log("colissimo_process_config: ok");
NODE

echo "colissimo_env: installed"
echo "colissimo_product: DOM"
echo "colissimo_label_purchases: disabled"
echo "COLISSIMO CONFIGURE OK"
