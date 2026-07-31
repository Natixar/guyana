#!/usr/bin/env bash
# deploy/steps/99-teardown.sh — retire le déploiement, et rien d'autre.
#
# Ne touche ni au réseau 'proxy', ni à Traefik, ni à aucun conteneur voisin.
#
# Exécuté sur la CIBLE.

set -euo pipefail
: "${APP_CONTAINER:?}"

for c in "$APP_CONTAINER" "${SIGNER_CONTAINER:-}" "${STORE_CONTAINER:-}" "${DB_CONTAINER:-}"; do
  [ -n "$c" ] || continue
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    docker rm -f "$c" >/dev/null
    echo "conteneur '$c' retiré"
  else
    echo "conteneur '$c' absent — rien à faire"
  fi
done

# Le volume de données SURVIT au démontage, délibérément. Un teardown qui
# détruit l'état transforme une correction de routage en perte de données, et
# rien dans le mot « teardown » ne prévient de cela. Sa destruction est un acte
# distinct, et elle doit se taper à la main :
#
#   docker volume rm ${DB_VOLUME:-guyana-db-data}
[ -n "${DB_VOLUME:-}" ] && echo "volume '$DB_VOLUME' conservé — le détruire est un acte distinct"

# Les volumes de secrets, eux, ne survivent pas : ils sont reconstruits à chaque
# déploiement depuis l'adaptateur, et un secret qui traîne est un secret de trop.
for v in "${SIGNER_CONTAINER:-}-secrets" "${STORE_CONTAINER:-}-secrets"; do
  case "$v" in -secrets) continue ;; esac
  docker volume rm "$v" >/dev/null 2>&1 && echo "volume de secrets '$v' retiré" || true
done
