#!/usr/bin/env bash
# Restrict github-ops SSH to cardoria-ops allowlisted argv only.
set -euo pipefail

cmd=${SSH_ORIGINAL_COMMAND:-}

case "$cmd" in
  status)
    exec sudo -n /usr/local/bin/cardoria-ops status
    ;;
  healthcheck)
    exec sudo -n /usr/local/bin/cardoria-ops healthcheck
    ;;
  restart)
    exec sudo -n /usr/local/bin/cardoria-ops restart
    ;;
  backup)
    exec sudo -n /usr/local/bin/cardoria-ops backup
    ;;
  nginx-test)
    exec sudo -n /usr/local/bin/cardoria-ops nginx-test
    ;;
  logs)
    exec sudo -n /usr/local/bin/cardoria-ops logs
    ;;
  rollback)
    exec sudo -n /usr/local/bin/cardoria-ops rollback
    ;;
  report)
    exec sudo -n /usr/local/bin/cardoria-ops report
    ;;
  backup-check)
    exec sudo -n /usr/local/bin/cardoria-ops backup-check
    ;;
  dns-check)
    exec sudo -n /usr/local/bin/cardoria-ops dns-check
    ;;
  https-enable)
    exec sudo -n /usr/local/bin/cardoria-ops https-enable
    ;;
  smtp-configure)
    exec sudo -n /usr/local/bin/cardoria-ops smtp-configure
    ;;
  deploy)
    exec sudo -n /usr/local/bin/cardoria-ops deploy
    ;;
  "deploy main")
    exec sudo -n /usr/local/bin/cardoria-ops deploy main
    ;;
  "deploy migration/oracle-free-20260902")
    exec sudo -n /usr/local/bin/cardoria-ops deploy migration/oracle-free-20260902
    ;;
  "deploy migration/ovh-ops-20260903")
    exec sudo -n /usr/local/bin/cardoria-ops deploy migration/ovh-ops-20260903
    ;;
  "deploy migration/ovh-chatgpt-access-20260903")
    exec sudo -n /usr/local/bin/cardoria-ops deploy migration/ovh-chatgpt-access-20260903
    ;;
  "deploy migration/ovh-https-cutover-20260903")
    exec sudo -n /usr/local/bin/cardoria-ops deploy migration/ovh-https-cutover-20260903
    ;;
  *)
    echo "FORBIDDEN"
    exit 1
    ;;
esac
