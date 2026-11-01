#!/bin/sh
# Delete only the verified IRL node namespace. Never prune the Docker host.
set -eu
umask 077
NODE_ID=$1
CONTROL_ID=$2
INSTALL_ID=$3
PHASE=$4
ALLOW_EMPTY=$5
MODE=$6
ROOT=${IRL_INSTALL_ROOT:-/var/lib/irl-manager-node}
step() { printf 'IRL_STEP:%s\n' "$1"; }
case "$NODE_ID:$INSTALL_ID" in *[!0-9a-f:-]*|'') echo 'Invalid node identity.' >&2; exit 1;; esac
[ "${#CONTROL_ID}" -eq 64 ] || { echo 'Invalid ownership fingerprint.' >&2; exit 1; }
case "$CONTROL_ID" in *[!0-9a-f]*) echo 'Invalid ownership fingerprint.' >&2; exit 1;; esac
case "$PHASE" in verify|apply) ;; *) exit 1;; esac
if [ "$MODE" = local ]; then
  case "$ROOT" in /*/local-node) ;; *) echo 'Unexpected local install directory.' >&2; exit 1;; esac
else
  [ "$ROOT" = /var/lib/irl-manager-node ] || { echo 'Unexpected remote install directory.' >&2; exit 1; }
fi
[ ! -L "$ROOT" ] || { echo 'Refusing to remove a symlinked install directory.' >&2; exit 1; }
if [ "$(uname -s)" = Linux ] && command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/irl-manager-node-install.lock
  # BusyBox flock supports -n but not util-linux's -w timeout option.
  attempts=0
  until flock -n 9; do
    [ "$attempts" -lt 60 ] || { echo 'Another node operation is running on this machine.' >&2; exit 1; }
    attempts=$((attempts + 1))
    sleep 1
  done
fi
step 'Verifying Docker host and node ownership'
docker info >/dev/null
printf 'IRL_MACHINE:%s\n' "$(docker info --format '{{.ID}}')"
PROOF=empty
CLAIM=0
if docker volume inspect irl-manager-node-identity >/dev/null 2>&1; then
  owner=$(docker run --rm -v irl-manager-node-identity:/identity:ro alpine:3.21 cat /identity/claim/owner)
  [ "$owner" = "$CONTROL_ID:$NODE_ID" ] || { echo 'This machine belongs to a different node. Nothing will be deleted.' >&2; exit 1; }
  PROOF=claim
  CLAIM=1
fi
if [ -d "$ROOT" ] && [ -f "$ROOT/.env" ]; then
  grep -Fqx "NODE_ID=$NODE_ID" "$ROOT/.env" || { echo 'The install directory belongs to a different node.' >&2; exit 1; }
  token=$(sed -n '/^NODE_TOKEN=/{s/^NODE_TOKEN=//;p;q;}' "$ROOT/.env")
  if command -v sha256sum >/dev/null 2>&1; then actual=$(printf '%s' "$token" | sha256sum | cut -d ' ' -f 1); else actual=$(printf '%s' "$token" | shasum -a 256 | cut -d ' ' -f 1); fi
  [ "$actual" = "$CONTROL_ID" ] || { echo 'The install directory has a different node credential.' >&2; exit 1; }
  PROOF=files
elif [ -e "$ROOT" ] && [ "$CLAIM" = 0 ] && [ "$ALLOW_EMPTY" != 1 ]; then
  echo 'Cannot verify ownership of the install directory. Nothing will be deleted.' >&2; exit 1
fi
containers=$(docker ps -aq --filter label=com.docker.compose.project=irl-node)
for id in $containers; do
  service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
  case "$service" in media|worker|srtla) ;; *) echo 'Unexpected service in the node project. Nothing will be deleted.' >&2; exit 1;; esac
  if [ "$service" = worker ]; then
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id" | grep -Fqx "NODE_ID=$NODE_ID" || { echo 'The running worker belongs to a different node. Nothing will be deleted.' >&2; exit 1; }
  fi
done
if [ "$PROOF" = empty ]; then
  [ -z "$containers" ] && [ ! -e "$ROOT" ] || { echo 'Cannot prove ownership of the remaining node resources.' >&2; exit 1; }
  [ -z "$(docker volume ls -q --filter label=com.docker.compose.project=irl-node)" ] || { echo 'Unverified node volumes remain.' >&2; exit 1; }
  [ -z "$(docker network ls -q --filter label=com.docker.compose.project=irl-node)" ] || { echo 'Unverified node networks remain.' >&2; exit 1; }
fi
printf 'IRL_PROOF:%s\n' "$PROOF"
if [ "$PHASE" = verify ]; then exit 0; fi
[ "$PROOF" != empty ] || [ "$ALLOW_EMPTY" = 1 ] || { echo 'Removal ownership must be verified before cleanup.' >&2; exit 1; }
step 'Stopping broadcasts and removing node containers'
# Stop the worker first; it owns every outgoing provider connection.
for id in $containers; do
  service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
  if [ "$service" = worker ]; then docker stop --time 10 "$id" >/dev/null; fi
done
for id in $containers; do docker stop --time 10 "$id" >/dev/null; docker rm --volumes "$id" >/dev/null; done
step 'Removing node data volumes and private networks'
for id in $(docker volume ls -q --filter label=com.docker.compose.project=irl-node); do docker volume rm "$id" >/dev/null; done
for id in $(docker network ls -q --filter label=com.docker.compose.project=irl-node); do docker network rm "$id" >/dev/null; done
step 'Removing node images (shared images are preserved)'
for image in irl-node-worker:latest irl-node-media:latest irl-node-srtla:latest; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    if ! docker image rm "$image" >/dev/null 2>&1; then printf 'Preserved shared or in-use image: %s\n' "$image"; fi
  fi
done
step 'Deleting node installation files and saved credentials'
if [ -d "$ROOT" ]; then find "$ROOT" -xdev -depth -delete; fi
archive="/tmp/irl-node-$INSTALL_ID.tgz"
if [ -f "$archive" ] && [ ! -L "$archive" ]; then
  # This exact generated job archive is a private installer artifact.
  unlink "$archive"
fi
step 'Releasing the machine node identity'
if [ "$CLAIM" = 1 ]; then docker volume rm irl-manager-node-identity >/dev/null; fi
printf 'IRL_REMOVED\n'
