#!/usr/bin/env bash
# Secure Mondial Relay credential installer for Cardoria OVH.
# Reads five secret values from stdin; never accepts secrets in argv.
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

for name in enseigne private_key api_login api_password customer_id; do
  value=${!name:-}
  if [ -z "$value" ] || [ "${#value}" -gt 512 ]; then
    echo "mondial_relay_secret_input: invalid"
    exit 1
  fi
  if printf '%s' "$value" | grep -q $'[\r\n]'; then
    echo "mondial_relay_secret_input: invalid"
    exit 1
  fi
done

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
  $1 != "MONDIAL_RELAY_LIVE_LABELS_ENABLED" &&
  $1 != "MONDIAL_RELAY_ALLOW_SANDBOX_TEST_LABEL"
' "$ENV_FILE" > "$tmp"

{
  printf '%s=%s\n' 'MONDIAL_RELAY_ENSEIGNE' "$enseigne"
  printf '%s=%s\n' 'MONDIAL_RELAY_PRIVATE_KEY' "$private_key"
  printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_LOGIN' "$api_login"
  printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_PASSWORD' "$api_password"
  printf '%s=%s\n' 'MONDIAL_RELAY_API_V2_CUSTOMER_ID' "$customer_id"
  printf '%s\n' 'MONDIAL_RELAY_API_V2_ENV=production'
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
STATUS_JSON="$status_json" node --input-type=module <<'NODE'
const data = JSON.parse(process.env.STATUS_JSON || "{}");
if (data.ok !== true) throw new Error("status endpoint failed");
if (data.servicePointSearchConfigured !== true) throw new Error("WSI4 configuration not loaded");
if (data.shipmentApiConfigured !== true) throw new Error("API V2 configuration not loaded");
if (data.labelPurchasesEnabled !== false) throw new Error("label purchases must remain disabled");
console.log("mondial_relay_process_config: ok");
NODE

echo "mondial_relay_env: installed"
echo "mondial_relay_environment: production"
echo "mondial_relay_label_purchases: disabled"
echo "MONDIAL RELAY CONFIGURE OK"
