#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

EMAIL=${CARDORIA_CERT_EMAIL:-cardoria59330@gmail.com}
certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d cardoriashop.fr -d www.cardoriashop.fr
systemctl reload nginx
certbot renew --dry-run
