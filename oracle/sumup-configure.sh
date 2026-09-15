#!/usr/bin/env bash
# Configure SumUp production credentials on OVH without exposing them in argv/logs.
set -euo pipefail
umask 077

if [ "${EUID}" -ne 0 ]; then
  echo "sumup-configure must run as root via sudoers"
  exit 1
fi

ENV_FILE=/etc/cardoria/cardoria.env

api_key=""
merchant_code=""
IFS= read -r api_key || true
IFS= read -r merchant_code || true
api_key=${api_key%$'\r'}
merchant_code=${merchant_code%$'\r'}

if [[ ! "$api_key" =~ ^[A-Za-z0-9._~+/=-]{16,4096}$ ]]; then
  echo "sumup_api_key: invalid"
  exit 1
fi
if [[ ! "$merchant_code" =~ ^[A-Za-z0-9_-]{3,64}$ ]]; then
  echo "sumup_merchant_code: invalid"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "env_file: missing"
  exit 1
fi

merchant_tmp=$(mktemp)
http_code=$(printf 'header = "Authorization: Bearer %s"\n' "$api_key" | \
  curl -sS --config - -o "$merchant_tmp" -w '%{http_code}' \
    "https://api.sumup.com/v1/merchants/${merchant_code}" || true)
rm -f "$merchant_tmp"
if [ "$http_code" != "200" ]; then
  echo "sumup_api_validation: failed HTTP ${http_code:-000}"
  exit 1
fi
echo "sumup_api_validation: ok"

old_env=$(mktemp)
new_env=$(mktemp)
cp -p "$ENV_FILE" "$old_env"
awk -F= '$1 != "SUMUP_API_KEY" && $1 != "SUMUP_MERCHANT_CODE" && $1 != "SUMUP_WEBHOOK_SECRET"' "$ENV_FILE" > "$new_env"
{
  printf '%s=%s\n' 'SUMUP_API_KEY' "$api_key"
  printf '%s=%s\n' 'SUMUP_MERCHANT_CODE' "$merchant_code"
} >> "$new_env"
install -m 0600 -o root -g root "$new_env" "$ENV_FILE"
rm -f "$new_env"
unset api_key merchant_code

rollback() {
  echo "sumup_configure: rollback"
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
  echo "sumup_restart_health: fail"
  rollback
  exit 1
fi

# Prove that the currently running Cardoria process actually loaded both
# SumUp variables, without ever printing their values.
main_pid=$(systemctl show cardoria --property=MainPID --value 2>/dev/null || true)
if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ ]] || [ ! -r "/proc/${main_pid}/environ" ]; then
  echo "sumup_process_env: unavailable"
  rollback
  exit 1
fi
if ! tr '\0' '\n' < "/proc/${main_pid}/environ" | grep -q '^SUMUP_API_KEY=.'; then
  echo "sumup_process_api_key: missing"
  rollback
  exit 1
fi
if ! tr '\0' '\n' < "/proc/${main_pid}/environ" | grep -q '^SUMUP_MERCHANT_CODE=.'; then
  echo "sumup_process_merchant_code: missing"
  rollback
  exit 1
fi

# Independently validate the protected env file through the application module.
if ! (
  set -a
  . "$ENV_FILE"
  set +a
  cd /opt/cardoria/current/backend
  node --input-type=module <<'NODE'
import { isSumUpConfigured } from "./lib/payments/sumup.js";
if (!isSumUpConfigured()) process.exit(1);
NODE
); then
  echo "sumup_env_module_validation: fail"
  rollback
  exit 1
fi

rm -f "$old_env"
echo "sumup_restart_health: ok"
echo "sumup_process_env: ok"
echo "sumup_env_module_validation: ok"
echo "sumup_configured: true"
echo "sumup_webhook_mode: api-verification"
echo "SUMUP CONFIGURE OK"
