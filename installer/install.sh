#!/bin/sh
# Executed only after the operator starts installation. Never echo credentials.
set -eu
umask 077
ROOT=${IRL_INSTALL_ROOT:-/var/lib/irl-manager-node}
ARCHIVE=$1
NODE_ID=$2
CONTROL_ID=$3
MODE=$4
step() { printf 'IRL_STEP:%s\n' "$1"; }
if [ "$(uname -s)" = Linux ] && command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/irl-manager-node-install.lock
  flock -w 1800 9 || { echo 'Another node installer is still running on this host.' >&2; exit 1; }
fi
step 'Checking host prerequisites'
if ! command -v docker >/dev/null 2>&1; then
  if [ "$MODE" = local ]; then echo 'Install Docker Engine/Desktop and Docker Compose on the current server, then retry.' >&2; exit 1; fi
  [ "$(uname -s)" = Linux ] || { echo 'Remote installation requires Linux.' >&2; exit 1; }
  . /etc/os-release
  case "$ID" in ubuntu|debian) ;; *) echo 'Automatic Docker installation supports Ubuntu and Debian. Install Docker Engine and Compose manually on this OS, then retry.' >&2; exit 1;; esac
  step 'Installing Docker Engine and Compose from the official Docker repository'
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker info >/dev/null
if [ "$MODE" = ssh ]; then
  # Existing Docker installs may lack the modern CLI plugins. Extract the
  # architecture-matched, static plugins from Docker's official CLI image.
  for plugin in compose buildx; do
    if ! docker "$plugin" version >/dev/null 2>&1; then
      step "Installing the Docker $plugin plugin"
      mkdir -p /usr/local/lib/docker/cli-plugins
      target="/usr/local/lib/docker/cli-plugins/docker-$plugin"
      docker run --rm --entrypoint cat docker:28-cli "/usr/local/libexec/docker/cli-plugins/docker-$plugin" > "$target.tmp"
      chmod 755 "$target.tmp"
      mv "$target.tmp" "$target"
    fi
  done
fi
docker compose version >/dev/null
# Every installation uses the same Docker-volume identity, regardless of SSH
# hostname, application checkout, workspace, or Linux user. mkdir is atomic.
step 'Claiming this machine for a single node'
docker volume create irl-manager-node-identity >/dev/null
docker run --rm -v irl-manager-node-identity:/identity alpine:3.21 sh -eu -c '
  expected="$1:$2"
  if mkdir /identity/claim 2>/dev/null; then
    printf "%s" "$expected" > /identity/claim/owner
  else
    owner=$(cat /identity/claim/owner 2>/dev/null || true)
    [ "$owner" = "$expected" ] || { echo "This machine already has an IRL node installation. Resume the original node instead." >&2; exit 1; }
  fi
' sh "$CONTROL_ID" "$NODE_ID"
printf 'IRL_MACHINE:%s\n' "$(docker info --format '{{.ID}}')"
mkdir -p "$ROOT"
# Docker runs from uploaded build contexts; no host source-directory bind mounts.
step 'Unpacking the node agent and media services'
tar -xzf "$ARCHIVE" -C "$ROOT"
rm -f "$ARCHIVE"
cd "$ROOT"
chmod 600 .env
step 'Building the media worker and SRTLA receiver (first install can take several minutes)'
docker compose -p irl-node -f infra/node-compose.yml --env-file .env build
step 'Starting the node agent, SRT/RTMP router, and SRTLA receiver'
docker compose -p irl-node -f infra/node-compose.yml --env-file .env up -d
step 'Waiting for the node to connect to the control panel'
