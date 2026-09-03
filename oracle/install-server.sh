#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root: sudo bash oracle/install-server.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg git nginx postgresql postgresql-contrib certbot python3-certbot-nginx build-essential python3 make g++ ufw

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id -u cardoria >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/cardoria --shell /bin/bash cardoria
mkdir -p /opt/cardoria/current /opt/cardoria/backups /etc/cardoria
chown -R cardoria:cardoria /opt/cardoria
chmod 750 /etc/cardoria

install -m 0644 oracle/cardoria.service /etc/systemd/system/cardoria.service
install -m 0644 oracle/cardoria-backup.service /etc/systemd/system/cardoria-backup.service
install -m 0644 oracle/cardoria-backup.timer /etc/systemd/system/cardoria-backup.timer
install -m 0644 oracle/nginx-cardoria.conf /etc/nginx/sites-available/cardoria
ln -sf /etc/nginx/sites-available/cardoria /etc/nginx/sites-enabled/cardoria
rm -f /etc/nginx/sites-enabled/default

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

systemctl daemon-reload
systemctl enable nginx postgresql cardoria cardoria-backup.timer
systemctl start cardoria-backup.timer
nginx -t
systemctl restart nginx

echo "Bootstrap OK. Next: configure /etc/cardoria/cardoria.env, PostgreSQL, then run oracle/deploy.sh"