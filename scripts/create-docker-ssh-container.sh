#!/usr/bin/env bash
set -euo pipefail

container_name="${CONTAINER_NAME:-ocircuit-ssh-container}"
ssh_public_key_file="${SSH_PUBLIC_KEY_FILE:-$HOME/.ssh/id_ed25519.pub}"
ssh_private_key_file="${SSH_PRIVATE_KEY_FILE:-${ssh_public_key_file%.pub}}"

if [[ ! -r "$ssh_public_key_file" ]]; then
  echo "SSH public key not found: $ssh_public_key_file" >&2
  echo "Set SSH_PUBLIC_KEY_FILE to an existing public key." >&2
  exit 1
fi

docker_context=$(mktemp -d)
trap 'rm -rf "$docker_context"' EXIT
cp "$ssh_public_key_file" "$docker_context/authorized_keys"

cat > "$docker_context/Dockerfile" <<'EOF'
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssh-server \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash devuser \
  && mkdir --mode=700 /home/devuser/.ssh \
  && mkdir --mode=755 /run/sshd

COPY authorized_keys /home/devuser/.ssh/authorized_keys

RUN chown -R devuser:devuser /home/devuser/.ssh \
  && chmod 600 /home/devuser/.ssh/authorized_keys \
  && printf '%s\n' \
    'Port 2222' \
    'PermitRootLogin no' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'UsePAM yes' >> /etc/ssh/sshd_config

EXPOSE 2222
CMD ["/usr/sbin/sshd", "-D", "-e"]
EOF

docker build --tag ocircuit-ubuntu-ssh "$docker_context"
docker run --detach \
  --publish 127.0.0.1:2222:2222 \
  --name "$container_name" \
  --security-opt=no-new-privileges \
  ocircuit-ubuntu-ssh

echo "Docker container ${container_name} is running on 127.0.0.1:2222"
if [[ -r "$ssh_private_key_file" ]]; then
  echo "SSH command: ssh devuser@localhost -p 2222 -i \"$ssh_private_key_file\""
else
  echo "SSH public key installed. Set SSH_PRIVATE_KEY_FILE to print the login command."
fi
