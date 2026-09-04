#!/usr/bin/env bash
# Cardoria OVH ops — allowlisted actions only. Run as root via sudoers.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "cardoria-ops must run as root via sudoers"
  exit 1
fi

APP_DIR=/opt/cardoria/current
BACKUP_DIR=/opt/cardoria/backups
PREV_FILE=/opt/cardoria/previous-commit
LAST_DEPLOY=/opt/cardoria/last-deploy
DB_NAME=cardoria
ENV_FILE=/etc/cardoria/cardoria.env
redact() {
  sed -E \
    -e 's/[Aa]uthorization:[[:space:]]*[^[:cntrl:]]+/Authorization: ***/g' \
    -e 's/[Cc]ookie:[[:space:]]*[^[:cntrl:]]+/Cookie: ***/g' \
    -e 's/[Ss]et-[Cc]ookie:[[:space:]]*[^[:cntrl:]]+/Set-Cookie: ***/g' \
    -e 's/(Bearer)[[:space:]]+[A-Za-z0-9._~+/=-]+/\1 ***/g' \
    -e 's/(password|passwd|pwd|token|secret|api[_-]?key|private[_-]?key|ADMIN_LOGIN_PASSWORD|ADMIN_INITIAL_PASSWORD|SMTP_PASS|REVOLUT_SECRET_KEY|REVOLUT_WEBHOOK_SECRET|PAYPAL_CLIENT_SECRET)[[:space:]"=:]+[^[:space:]]+/\1=***/Ig' \
    -e 's#postgres(ql)?://[^[:space:]/<>"]+#postgresql://***#g' \
    -e 's#([?&](password|token|key|secret|pwd)=)[^&[:space:]"]+#\1***#Ig' \
    -e 's#/etc/cardoria/cardoria\.env#[env-file]#g'
}

require_action() {
  case "$1" in
    status|healthcheck|deploy|restart|backup|nginx-test|logs|rollback|report|backup-check|dns-check|https-enable|smtp-configure) return 0 ;;
    *) echo "FORBIDDEN action"; exit 1 ;;
  esac
}

validate_branch() {
  local branch=$1
  case "$branch" in
    main|migration/oracle-free-20260902|migration/ovh-ops-20260903|migration/ovh-chatgpt-access-20260903|migration/ovh-https-cutover-20260903) return 0 ;;
    *) echo "FORBIDDEN branch"; exit 1 ;;
  esac
}

run_healthcheck() {
  local base=${1:-http://127.0.0.1:10000}
  rm -f /tmp/cardoria-check.out
  bash "$APP_DIR/oracle/healthcheck.sh" "$base" | redact
}

wait_health() {
  local i
  for i in $(seq 1 45); do
    if curl -fsS http://127.0.0.1:10000/api/health/ >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

pg_ok() {
  sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1" 2>/dev/null | grep -qx 1
}

cmd_status() {
  echo "=== CARDORIA OPS STATUS ==="
  echo "time_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -d "$APP_DIR/.git" ]; then
    echo "commit: $(git -C "$APP_DIR" rev-parse HEAD)"
    echo "branch: $(git -C "$APP_DIR" branch --show-current)"
  else
    echo "commit: unknown"
    echo "branch: unknown"
  fi
  echo "cardoria: $(systemctl is-active cardoria 2>/dev/null || echo unknown) / $(systemctl is-enabled cardoria 2>/dev/null || echo unknown)"
  echo "nginx: $(systemctl is-active nginx 2>/dev/null || echo unknown) / $(systemctl is-enabled nginx 2>/dev/null || echo unknown)"
  echo "postgresql: $(systemctl is-active postgresql 2>/dev/null || echo unknown) / $(systemctl is-enabled postgresql 2>/dev/null || echo unknown)"
  echo "uptime_cardoria: $(systemctl show cardoria -p ActiveEnterTimestamp --value 2>/dev/null || echo unknown)"
  echo "last_deploy: $( [ -f "$LAST_DEPLOY" ] && cat "$LAST_DEPLOY" || echo none )"
  echo "previous_commit: $( [ -s "$PREV_FILE" ] && cat "$PREV_FILE" || echo none )"
  echo "--- disk ---"
  df -hT / | awk 'NR==1 || /\/$/'
  echo "--- memory ---"
  free -h
  echo "--- ports ---"
  ss -tlnH | awk '{print $1,$4}' | sed -E 's/users:\(.*//; s/[[:space:]]+$//'
  echo "--- backups ---"
  if [ -d "$BACKUP_DIR" ]; then
    find "$BACKUP_DIR" -type f \( -name 'cardoria-postgres-*.dump' -o -name 'cardoria-data-*.tar.gz' \) -printf '%TY-%Tm-%TdT%TH:%TM:%TS %p\n' 2>/dev/null | sort | tail -n 6
  else
    echo "none"
  fi
  echo "--- postgres ---"
  if pg_ok; then
    echo "postgres_connect: ok"
    echo "postgres_listen: $(sudo -u postgres psql -tAc "SHOW listen_addresses;" 2>/dev/null | tr -d '[:space:]')"
    echo "postgres_size: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));" 2>/dev/null | tr -d '[:space:]')"
    echo "postgres_tables: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>/dev/null | tr -d '[:space:]')"
    echo "postgres_mk_sellers: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT to_regclass('public.mk_sellers') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
    echo "postgres_sync_meta: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT to_regclass('public.marketplace_sync_meta') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
    echo "postgres_listings: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM mk_listings;" 2>/dev/null | tr -d '[:space:]' || echo na)"
    echo "postgres_sellers: $(sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT count(*) FROM mk_sellers;" 2>/dev/null | tr -d '[:space:]' || echo na)"
  else
    echo "postgres_connect: fail"
  fi
  echo "--- health ---"
  curl -sS http://127.0.0.1:10000/api/health/ 2>/dev/null | redact || echo "health: unreachable"
  echo
  curl -sS http://127.0.0.1:10000/api/health/startup 2>/dev/null | redact || echo "startup: unreachable"
  echo
}

cmd_healthcheck() {
  echo "=== HEALTHCHECK :10000 ==="
  run_healthcheck http://127.0.0.1:10000
  echo "=== HEALTHCHECK nginx :80 ==="
  run_healthcheck http://127.0.0.1
}

cmd_nginx_test() {
  echo "=== NGINX TEST ==="
  nginx -t
  echo "http80: $(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health/ || echo fail)"
  echo "listen:"
  ss -tlnH | awk '$4 ~ /:(80|443|10000)$/ {print $4}'
  echo "ufw:"
  ufw status | redact
}

cmd_logs() {
  echo "=== CARDORIA LOGS (max 200) ==="
  journalctl -u cardoria -n 200 --no-pager --output=short-iso | redact
}

cmd_backup() {
  echo "=== BACKUP ==="
  local stamp before after dump tarfile rc
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  before=$(find "$BACKUP_DIR" -type f 2>/dev/null | wc -l)
  set +e
  bash "$APP_DIR/oracle/backup.sh" >/tmp/cardoria-ops-backup.out 2>&1
  rc=$?
  set -e
  redact < /tmp/cardoria-ops-backup.out
  rm -f /tmp/cardoria-ops-backup.out
  dump=$(find "$BACKUP_DIR" -name "cardoria-postgres-*.dump" -mmin -10 | tail -n 1)
  tarfile=$(find "$BACKUP_DIR" -name "cardoria-data-*.tar.gz" -mmin -10 | tail -n 1)
  after=$(find "$BACKUP_DIR" -type f 2>/dev/null | wc -l)
  echo "backup_script_exit: $rc"
  echo "backup_files_before: $before"
  echo "backup_files_after: $after"
  if [ -n "$dump" ]; then echo "postgres_dump: present $(basename "$dump")"; else echo "postgres_dump: missing"; fi
  if [ -n "$tarfile" ]; then echo "data_archive: present $(basename "$tarfile")"; else echo "data_archive: missing"; fi
  if [ -z "$dump" ] || [ -z "$tarfile" ]; then
    echo "BACKUP INCOMPLETE"
    return 1
  fi
  echo "BACKUP OK"
}

cmd_report() {
  echo "=== CARDORIA OPS REPORT ==="
  cmd_status
}

cmd_backup_check() {
  echo "=== BACKUP CHECK ==="
  local dump tarfile dump_bytes tar_bytes
  dump=$(find "$BACKUP_DIR" -type f -name 'cardoria-postgres-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | awk '{print $2}')
  tarfile=$(find "$BACKUP_DIR" -type f -name 'cardoria-data-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | awk '{print $2}')
  if [ -z "$dump" ] || [ ! -f "$dump" ]; then
    echo "postgres_dump: missing"
    return 1
  fi
  dump_bytes=$(stat -c '%s' "$dump")
  echo "postgres_dump: $(basename "$dump")"
  echo "postgres_dump_bytes: $dump_bytes"
  if [ "$dump_bytes" -le 0 ]; then
    echo "postgres_dump: empty"
    return 1
  fi
  if ! pg_restore -l "$dump" >/dev/null 2>&1; then
    echo "postgres_dump: unreadable"
    return 1
  fi
  echo "postgres_dump: readable"
  if [ -z "$tarfile" ] || [ ! -f "$tarfile" ]; then
    echo "data_archive: missing"
    return 1
  fi
  tar_bytes=$(stat -c '%s' "$tarfile")
  echo "data_archive: $(basename "$tarfile")"
  echo "data_archive_bytes: $tar_bytes"
  if [ "$tar_bytes" -le 0 ]; then
    echo "data_archive: empty"
    return 1
  fi
  if ! tar -tzf "$tarfile" >/dev/null 2>&1; then
    echo "data_archive: unreadable"
    return 1
  fi
  echo "data_archive: readable"
  echo "BACKUP CHECK OK"
}

cmd_restart() {
  echo "=== RESTART ==="
  systemctl restart cardoria
  if wait_health; then
    echo "restart_health: ok"
    run_healthcheck http://127.0.0.1:10000
  else
    echo "restart_health: fail"
    return 1
  fi
}

install_ops_from_repo() {
  if [ -f "$APP_DIR/oracle/cardoria-ops.sh" ]; then
    install -m 0755 -o root -g root "$APP_DIR/oracle/cardoria-ops.sh" /usr/local/bin/cardoria-ops
  fi
  if [ -f "$APP_DIR/oracle/cardoria-ops-ssh-wrapper.sh" ]; then
    install -m 0755 -o root -g root "$APP_DIR/oracle/cardoria-ops-ssh-wrapper.sh" /usr/local/bin/cardoria-ops-ssh-wrapper
  fi
  if [ -f "$APP_DIR/oracle/sudoers-cardoria-ops" ]; then
    tmp=$(mktemp)
    cp "$APP_DIR/oracle/sudoers-cardoria-ops" "$tmp"
    chmod 0440 "$tmp"
    if visudo -cf "$tmp"; then
      install -m 0440 -o root -g root "$APP_DIR/oracle/sudoers-cardoria-ops" /etc/sudoers.d/cardoria-ops
    else
      echo "sudoers update skipped: visudo rejected the repo file"
    fi
    rm -f "$tmp"
  fi
}

cmd_dns_check() {
  echo "=== DNS CHECK ==="
  local expected=51.89.174.191
  local apex www
  apex=$(getent ahostsv4 cardoriashop.fr 2>/dev/null | awk '/STREAM/ {print $1; exit}')
  www=$(getent ahostsv4 www.cardoriashop.fr 2>/dev/null | awk '/STREAM/ {print $1; exit}')
  echo "expected_ipv4: $expected"
  echo "apex_ipv4: ${apex:-unresolved}"
  echo "www_ipv4: ${www:-unresolved}"
  if [ "$apex" = "$expected" ] && [ "$www" = "$expected" ]; then
    echo "dns_on_vps: yes"
    return 0
  fi
  echo "dns_on_vps: no"
  return 1
}

cmd_https_enable() {
  echo "=== HTTPS ENABLE ==="
  if ! cmd_dns_check; then
    echo "Refusing HTTPS until public DNS points to this VPS"
    return 1
  fi
  bash "$APP_DIR/oracle/enable-https.sh" | redact
  echo "=== POST-HTTPS LOCAL HEALTHCHECK ==="
  run_healthcheck http://127.0.0.1:10000
}

cmd_smtp_configure() {
  echo "=== SMTP CONFIGURE ==="
  local smtp_pass tmp rc
  IFS= read -r smtp_pass || true
  smtp_pass=${smtp_pass//[[:space:]]/}
  if [[ ! "$smtp_pass" =~ ^[A-Za-z0-9]{16,128}$ ]]; then
    echo "smtp_secret: invalid"
    return 1
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "env_file: missing"
    return 1
  fi
  tmp=$(mktemp)
  awk -F= '$1 != "SMTP_HOST" && $1 != "SMTP_PORT" && $1 != "SMTP_SECURE" && $1 != "SMTP_USER" && $1 != "SMTP_PASS" && $1 != "MAIL_FROM"' "$ENV_FILE" > "$tmp"
  {
    printf 'SMTP_HOST=smtp.gmail.com\n'
    printf 'SMTP_PORT=587\n'
    printf 'SMTP_SECURE=false\n'
    printf 'SMTP_USER=Cardoria59330@gmail.com\n'
    printf '%s=%s\n' 'SMTP_PASS' "$smtp_pass"
    printf 'MAIL_FROM=Cardoria59330@gmail.com\n'
  } >> "$tmp"
  install -m 0600 -o root -g root "$tmp" "$ENV_FILE"
  rm -f "$tmp"
  unset smtp_pass

  systemctl restart cardoria
  if ! wait_health; then
    echo "smtp_restart_health: fail"
    return 1
  fi
  set +e
  (
    set -a
    . "$ENV_FILE"
    set +a
    cd "$APP_DIR/backend"
    node --input-type=module <<'NODE'
import { sendEmail } from "./lib/email.js";
const sent = await sendEmail({
  to: "Cardoria59330@gmail.com",
  subject: "Cardoria - SMTP OVH opérationnel",
  text: "Le service sécurisé d'envoi d'e-mail Cardoria sur le VPS OVH est opérationnel."
});
process.exit(sent ? 0 : 1);
NODE
  ) >/tmp/cardoria-ops-smtp.out 2>&1
  rc=$?
  set -e
  redact < /tmp/cardoria-ops-smtp.out
  rm -f /tmp/cardoria-ops-smtp.out
  if [ "$rc" -ne 0 ]; then
    echo "smtp_test: fail"
    return 1
  fi
  echo "smtp_config: installed"
  echo "smtp_test: success"
  echo "SMTP CONFIGURE OK"
}

cmd_deploy() {
  local branch=$1
  validate_branch "$branch"
  echo "=== DEPLOY $branch ==="
  if ! cmd_backup; then
    echo "Refusing deploy without backup artifacts"
    return 1
  fi
  export CARDORIA_BRANCH="$branch"
  bash "$APP_DIR/oracle/deploy.sh"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_DEPLOY"
  install_ops_from_repo
  echo "=== POST-DEPLOY HEALTHCHECK ==="
  if ! run_healthcheck http://127.0.0.1:10000; then
    echo "Deploy healthcheck failed, rollback"
    bash "$APP_DIR/oracle/rollback.sh" | redact
    return 1
  fi
  echo "DEPLOY OK"
}

cmd_rollback() {
  echo "=== ROLLBACK ==="
  if [ ! -s "$PREV_FILE" ]; then
    echo "No previous commit recorded"
    return 1
  fi
  bash "$APP_DIR/oracle/rollback.sh" | redact
  date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_DEPLOY"
  echo "=== POST-ROLLBACK HEALTHCHECK ==="
  run_healthcheck http://127.0.0.1:10000
}

ACTION=${1:-}
require_action "$ACTION"
shift || true
install_ops_from_repo

case "$ACTION" in
  status) cmd_status ;;
  healthcheck) cmd_healthcheck ;;
  nginx-test) cmd_nginx_test ;;
  logs) cmd_logs ;;
  backup) cmd_backup ;;
  restart) cmd_restart ;;
  deploy)
    BRANCH=${1:-}
    if [ -z "$BRANCH" ]; then
      BRANCH=$(git -C "$APP_DIR" branch --show-current)
    fi
    cmd_deploy "$BRANCH"
    ;;
  rollback) cmd_rollback ;;
  report) cmd_report ;;
  backup-check) cmd_backup_check ;;
  dns-check) cmd_dns_check ;;
  https-enable) cmd_https_enable ;;
  smtp-configure) cmd_smtp_configure ;;
esac
