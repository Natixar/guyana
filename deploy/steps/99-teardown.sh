#!/usr/bin/env bash
# deploy/steps/99-teardown.sh — retire le déploiement, et rien d'autre.
#
# Ne touche ni au réseau 'proxy', ni à Traefik, ni à aucun conteneur voisin.
#
# Exécuté sur la CIBLE.

set -euo pipefail
: "${APP_CONTAINER:?}"

if docker ps -a --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  docker rm -f "$APP_CONTAINER" >/dev/null
  echo "conteneur '$APP_CONTAINER' retiré"
else
  echo "conteneur '$APP_CONTAINER' absent — rien à faire"
fi
