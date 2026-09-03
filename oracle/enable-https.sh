#!/usr/bin/env bash
# Enable Let's Encrypt HTTPS for CardoriaShop. Fail closed if public DNS
# does not already point at this VPS. No secret values are printed.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

EXPECTED_IPV4=51.89.174.191
EMAIL=${CARDORIA_CERT_EMAIL:-cardoria59330@gmail.com}
SRC_DIR=$(cd "$(dirname "$0")" && pwd)
ACME_ROOT=/var/www/cardoria-acme
NGINX_SITE=/etc/nginx/sites-available/cardoria
CERT_LIVE=/etc/letsencrypt/live/cardoriashop.fr/fullchain.pem

resolve_ipv4() {
  local host=$1
  getent ahostsv4 "$host" 2>/dev/null | awk '/STREAM/ {print $1; exit}'
}

dns_points_here() {
  local apex www
  apex=$(resolve_ipv4 cardoriashop.fr || true)
  www=$(resolve_ipv4 www.cardoriashop.fr || true)
  echo "expected_ipv4: ${EXPECTED_IPV4}"
  echo "apex_ipv4: ${apex:-unresolved}"
  echo "www_ipv4: ${www:-unresolved}"
  if [ "$apex" != "$EXPECTED_IPV4" ] || [ "$www" != "$EXPECTED_IPV4" ]; then
    echo "DNS_NOT_ON_VPS"
    return 1
  fi
  echo "dns_on_vps: yes"
}

install_http_nginx() {
  mkdir -p "$ACME_ROOT"
  install -m 0644 "$SRC_DIR/nginx-cardoria.conf" "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/cardoria
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
}

install_ssl_nginx() {
  install -m 0644 "$SRC_DIR/nginx-cardoria-ssl.conf" "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/cardoria
  nginx -t
  systemctl reload nginx
}

verify_https() {
  local code location
  echo "=== HTTPS VERIFY ==="
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://www.cardoriashop.fr/api/health/ || echo fail)
  echo "https_www_health: $code"
  [ "$code" = "200" ]

  location=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 http://www.cardoriashop.fr/ || true)
  echo "http_www: $location"
  location=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 http://cardoriashop.fr/ || true)
  echo "http_apex: $location"
  location=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 https://cardoriashop.fr/ || true)
  echo "https_apex: $location"

  echo "tls_www:"
  echo | openssl s_client -servername www.cardoriashop.fr -connect www.cardoriashop.fr:443 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates
  echo "HTTPS_OK"
}

echo "=== DNS CHECK ==="
if ! dns_points_here; then
  echo "Refusing certbot until cardoriashop.fr and www.cardoriashop.fr resolve to this VPS"
  exit 1
fi

ufw allow 'Nginx Full' >/dev/null 2>&1 || true
install_http_nginx

echo "=== CERTBOT ==="
certbot certonly \
  --webroot -w "$ACME_ROOT" \
  --non-interactive --agree-tos --email "$EMAIL" \
  -d cardoriashop.fr -d www.cardoriashop.fr

if [ ! -f "$CERT_LIVE" ]; then
  echo "Certificate file missing after certbot"
  exit 1
fi

install_ssl_nginx
verify_https
echo "ENABLE HTTPS OK"
