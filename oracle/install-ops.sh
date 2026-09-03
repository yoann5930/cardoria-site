#!/usr/bin/env bash
# Install restricted GitHub Actions ops user. Requires a public key file argument.
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root: sudo bash oracle/install-ops.sh /path/to/cardoria_github_actions.pub"
  exit 1
fi

PUB_FILE=${1:-}
if [ -z "$PUB_FILE" ] || [ ! -f "$PUB_FILE" ]; then
  echo "Usage: sudo bash oracle/install-ops.sh /path/to/cardoria_github_actions.pub"
  exit 1
fi

if ! grep -q 'ssh-ed25519 ' "$PUB_FILE"; then
  echo "Public key file must contain an ssh-ed25519 line"
  exit 1
fi
if grep -q 'BEGIN OPENSSH PRIVATE KEY' "$PUB_FILE"; then
  echo "Refusing private key material"
  exit 1
fi

SRC_DIR=$(cd "$(dirname "$0")" && pwd)
install -m 0755 -o root -g root "$SRC_DIR/cardoria-ops.sh" /usr/local/bin/cardoria-ops
install -m 0755 -o root -g root "$SRC_DIR/cardoria-ops-ssh-wrapper.sh" /usr/local/bin/cardoria-ops-ssh-wrapper
install -m 0440 -o root -g root "$SRC_DIR/sudoers-cardoria-ops" /etc/sudoers.d/cardoria-ops
visudo -cf /etc/sudoers.d/cardoria-ops
install -m 0644 -o root -g root "$SRC_DIR/sshd-cardoria-ops.conf" /etc/ssh/sshd_config.d/cardoria-ops.conf
sshd -t

id -u github-ops >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/github-ops --shell /bin/bash github-ops
passwd -l github-ops >/dev/null
mkdir -p /home/github-ops/.ssh
chmod 700 /home/github-ops/.ssh
PUB_LINE=$(grep '^ssh-ed25519 ' "$PUB_FILE" | head -n 1)
printf 'restrict,command="/usr/local/bin/cardoria-ops-ssh-wrapper" %s\n' "$PUB_LINE" > /home/github-ops/.ssh/authorized_keys
chown -R github-ops:github-ops /home/github-ops/.ssh
chmod 600 /home/github-ops/.ssh/authorized_keys

systemctl reload ssh || systemctl reload sshd
echo "cardoria-ops installed for user github-ops"
