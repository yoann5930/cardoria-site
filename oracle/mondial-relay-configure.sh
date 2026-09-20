#!/usr/bin/env bash
# Secure Mondial Relay credential installer for Cardoria OVH.
# Reads WSI4 values from stdin, then optional API V2 values. Never accepts secrets in argv.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "mondial-relay-configure must run as root via sudoers"
  exit 1
fi

ENV_FILE=/etc/cardoria/cardoria.env
APP_DIR=/opt/cardoria/current

IFS= read -r enseigne || true
IFS= read -r private_key || true
IFS= read -r api_login || true
IFS= read -r api_password || true
IFS= read -r customer_id || true

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

if ! valid_secret "$enseigne" || ! valid_secret "$private_key"; then
  echo "mondial_relay_secret_input: invalid"
  exit 1
fi

v2_count=0
[ -n "${api_login:-}" ] && v2_count=$((v2_count + 1))
[ -n "${api_password:-}" ] && v2_count=$((v2_count + 1))
[ -n "${customer_id:-}" ] && v2_count=$((v2_count + 1))
has_v2=0
if [ "$v2_count" -eq 3 ]; then
  if ! valid_secret "$api_login" || ! valid_secret "$api_password" || ! valid_secret "$customer_id"; then
    echo "mondial_relay_secret_input: invalid"
    exit 1
  fi
  has_v2=1
elif [ "$v2_count" -ne 0 ]; then
  echo "mondial_relay_secret_input: invalid"
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
  $1 != "MONDIAL_RELAY_ENSEIGNE" &&
  $1 != "MONDIAL_RELAY_PRIVATE_KEY" &&
  $1 != "MONDIAL_RELAY_API_V2_LOGIN" &&
  $1 != "MONDIAL_RELAY_API_V2_PASSWORD" &&
  $1 != "MONDIAL_RELAY_API_V2_CUSTOMER_ID" &&
  $1 != "MONDIAL_RELAY_API_V2_ENV" &&
  $1 != "MONDIAL_RELAY_LIVE_LABELS_ENABLED"
' "$ENV_FILE" > "$tmp"

{
  printf '%s=%s\n' 'MONDIAL_RELAY_ENSEIGNE' "$enseigne"
  printf '%s=%s\n' 'MONDIAL_RELAY_PRIVATE_KEY' "$private_key"
  if [ "$has_v2" -eq 1 ]; then
    printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_LOGIN' "$api_login"
    printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_PASSWORD' "$api_password"
    printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_CUSTOMER_ID' "$customer_id"
  fi
  printf '%s\n' 'MONDIAL_RELAY_API_V2_ENV=sandbox'
  printf '%s\n' 'MONDIAL_RELAY_LIVE_LABELS_ENABLED=false'
} >> "$tmp"

install -m 0600 -o root -g root "$tmp" "$ENV_FILE"
unset enseigne private_key api_login api_password customer_id

systemctl restart cardoria

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:10000/api/health/ >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 45 ]; then
    install -m 0600 -o root -g root "$backup" "$ENV_FILE"
    systemctl restart cardoria
    echo "mondial_relay_configure: rollback"
    exit 1
  fi
  sleep 2
done

status_json=$(curl -fsS http://127.0.0.1:10000/api/mondial-relay/status)
HAS_V2="$has_v2" STATUS_JSON="$status_json" node --input-type=module <<'NODE'
const data = JSON.parse(process.env.STATUS_JSON || "{}");
if (data.ok !== true) throw new Error("status endpoint failed");
if (data.servicePointSearchConfigured !== true) throw new Error("WSI4 configuration not loaded");
if (data.labelPurchasesEnabled !== false) throw new Error("label purchases must remain disabled");
if (process.env.HAS_V2 === "1" && data.shipmentApiConfigured !== true) throw new Error("API V2 configuration not loaded");
if (process.env.HAS_V2 !== "1" && data.shipmentApiConfigured === true) throw new Error("API V2 must stay unconfigured without credentials");
console.log("mondial_relay_process_config: ok");
NODE

echo "mondial_relay_env: installed"
echo "mondial_relay_environment: sandbox"
if [ "$has_v2" -eq 1 ]; then
  echo "mondial_relay_shipment_api: configured"
else
  echo "mondial_relay_shipment_api: skipped"
fi
echo "mondial_relay_label_purchases: disabled"
echo "MONDIAL RELAY CONFIGURE OK"
