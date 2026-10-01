#!/usr/bin/env bash
# Configure PayPal Live credentials on OVH without exposing them in argv or logs.
set -euo pipefail
umask 077

if [ "${EUID}" -ne 0 ]; then
  echo "paypal-configure must run as root via sudoers"
  exit 1
fi

ENV_FILE=/etc/cardoria/cardoria.env
APP_DIR=/opt/cardoria/current

client_id=""
client_secret=""
partner_merchant_id=""
partner_attribution_id=""
webhook_id=""
IFS= read -r client_id || true
IFS= read -r client_secret || true
IFS= read -r partner_merchant_id || true
IFS= read -r partner_attribution_id || true
IFS= read -r webhook_id || true
client_id=${client_id%$'\r'}
client_secret=${client_secret%$'\r'}
partner_merchant_id=${partner_merchant_id%$'\r'}
partner_attribution_id=${partner_attribution_id%$'\r'}
webhook_id=${webhook_id%$'\r'}

if [[ ! "$client_id" =~ ^[A-Za-z0-9._~+/-]{8,256}$ ]]; then
  echo "paypal_client_id: invalid"
  exit 1
fi
if [[ ! "$client_secret" =~ ^[A-Za-z0-9._~+/-]{8,256}$ ]]; then
  echo "paypal_client_secret: invalid"
  exit 1
fi
if [[ ! "$partner_merchant_id" =~ ^[A-Za-z0-9_-]{6,32}$ ]]; then
  echo "paypal_partner_merchant_id: invalid"
  exit 1
fi
if [[ ! "$partner_attribution_id" =~ ^[A-Za-z0-9_-]{3,128}$ ]]; then
  echo "paypal_partner_attribution_id: invalid"
  exit 1
fi
if [[ ! "$webhook_id" =~ ^[A-Za-z0-9_-]{6,64}$ ]]; then
  echo "paypal_webhook_id: invalid"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "env_file: missing"
  exit 1
fi

old_env=$(mktemp)
new_env=$(mktemp)
cp -p "$ENV_FILE" "$old_env"
awk -F= '$1 != "PAYPAL_ENV" && $1 != "PAYPAL_CLIENT_ID" && $1 != "PAYPAL_CLIENT_SECRET" && $1 != "PAYPAL_PARTNER_MERCHANT_ID" && $1 != "PAYPAL_PARTNER_ATTRIBUTION_ID" && $1 != "PAYPAL_WEBHOOK_ID" && $1 != "PAYPAL_DISBURSEMENT_MODE"' "$ENV_FILE" > "$new_env"
{
  printf '%s=%s\n' 'PAYPAL_ENV' 'live'
  printf '%s=%s\n' 'PAYPAL_CLIENT_ID' "$client_id"
  printf '%s=%s\n' 'PAYPAL_CLIENT_SECRET' "$client_secret"
  printf '%s=%s\n' 'PAYPAL_PARTNER_MERCHANT_ID' "$partner_merchant_id"
  printf '%s=%s\n' 'PAYPAL_PARTNER_ATTRIBUTION_ID' "$partner_attribution_id"
  printf '%s=%s\n' 'PAYPAL_WEBHOOK_ID' "$webhook_id"
  printf '%s=%s\n' 'PAYPAL_DISBURSEMENT_MODE' 'INSTANT'
} >> "$new_env"
install -m 0600 -o root -g root "$new_env" "$ENV_FILE"
rm -f "$new_env"
unset client_id client_secret partner_merchant_id partner_attribution_id webhook_id

rollback() {
  echo "paypal_configure: rollback"
  install -m 0600 -o root -g root "$old_env" "$ENV_FILE"
  systemctl restart cardoria || true
  rm -f "$old_env"
}

systemctl restart cardoria
healthy=0
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:10000/api/health/ >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  echo "paypal_restart_health: fail"
  rollback
  exit 1
fi

main_pid=$(systemctl show cardoria --property=MainPID --value 2>/dev/null || true)
if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ ]] || [ ! -r "/proc/${main_pid}/environ" ]; then
  echo "paypal_process_env: unavailable"
  rollback
  exit 1
fi
for key in PAYPAL_ENV PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_PARTNER_MERCHANT_ID PAYPAL_PARTNER_ATTRIBUTION_ID PAYPAL_WEBHOOK_ID PAYPAL_DISBURSEMENT_MODE; do
  if ! tr '\0' '\n' < "/proc/${main_pid}/environ" | grep -q "^${key}="; then
    echo "paypal_process_${key}: missing"
    rollback
    exit 1
  fi
  echo "paypal_process_${key}: present"
done

if ! (
  set -a
  . "$ENV_FILE"
  set +a
  cd "$APP_DIR/backend"
  node --input-type=module <<'NODE'
import { getPayPalMarketplaceConfig, probePayPalLiveOAuth } from "./lib/marketplace/paypal.js";
import { paypalWebhookConfigured } from "./lib/marketplace/paypal-events.js";
const names = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_PARTNER_MERCHANT_ID", "PAYPAL_PARTNER_ATTRIBUTION_ID", "PAYPAL_WEBHOOK_ID"];
for (const name of names) {
  const present = Boolean(String(process.env[name] || "").trim());
  console.log(`${name}_present: ${present ? "yes" : "no"}`);
  if (!present) process.exit(2);
}
const cfg = getPayPalMarketplaceConfig();
const webhook = paypalWebhookConfigured();
const probe = await probePayPalLiveOAuth();
console.log(`paypal_environment: ${cfg.environment}`);
console.log(`paypal_configured: ${cfg.configured ? "yes" : "no"}`);
console.log(`paypal_webhook_configured: ${webhook ? "yes" : "no"}`);
console.log(`paypal_oauth: ${probe.ok ? "ok" : "fail"}`);
if (cfg.environment !== "live" || !cfg.configured || !webhook || !probe.ok) process.exit(1);
NODE
); then
  echo "paypal_env_module_validation: fail"
  rollback
  exit 1
fi

rm -f "$old_env"
echo "paypal_restart_health: ok"
echo "paypal_env_module_validation: ok"
echo "PAYPAL CONFIGURE OK"
