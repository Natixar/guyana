#!/usr/bin/env bash
# deploy/steps/30-network.sh — vérifie le réseau, ne le crée pas.
#
# Le réseau 'proxy' appartient au projet Compose de Traefik, pas à nous. Le
# fournisseur docker de Traefik y est épinglé (network: "proxy" dans sa
# configuration statique) : un conteneur qui n'y est pas sera découvert par
# Traefik mais restera injoignable, ce qui est le mode d'échec le plus
# probable pour qui déploie ici la première fois.
#
# Nous ne le créons pas : le créer signifierait qu'il a disparu, et dans ce cas
# c'est Traefik qu'il faut regarder, pas notre déploiement.
#
# Exécuté sur la CIBLE.

set -euo pipefail
: "${PROXY_NETWORK:?}"

if ! docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1; then
  echo "[ERREUR] le réseau '$PROXY_NETWORK' n'existe pas." >&2
  echo "         Il appartient au projet Compose de Traefik. Ne pas le recréer :" >&2
  echo "         son absence signale un problème du proxy, pas du déploiement." >&2
  exit 1
fi
echo "réseau '$PROXY_NETWORK' présent"
