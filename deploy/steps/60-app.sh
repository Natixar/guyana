#!/usr/bin/env bash
# deploy/steps/60-app.sh — lance le conteneur applicatif et déclare son routage.
#
# Tout le routage Traefik est déclaré ici, en labels sur NOTRE conteneur. Nous
# n'écrivons jamais dans /home/traefik/routing : ce répertoire porte la
# configuration TLS globale et les routes d'autres services, il ne nous
# appartient pas.
#
# Exécuté sur la CIBLE.

set -euo pipefail
: "${APP_CONTAINER:?}" "${APP_IMAGE:?}" "${PROXY_NETWORK:?}" "${APP_DOMAINS:?}" "${ROUTER_PREFIX:?}"

# --- Vérification de l'image ---------------------------------------------
# Le plan exige un déploiement par digest attesté. Tant que la chaîne
# d'intégration continue et le registre n'existent pas, on se contente de
# refuser toute divergence entre l'image demandée et celle réellement présente.
# C'est une mesure d'attente explicite, pas la cible.
actual_id=$(docker image inspect "$APP_IMAGE" --format '{{.Id}}' 2>/dev/null) || {
  echo "[ERREUR] image absente sur la cible : $APP_IMAGE" >&2; exit 1; }
if [ -n "${APP_IMAGE_ID:-}" ] && [ "$APP_IMAGE_ID" != "$actual_id" ]; then
  echo "[ERREUR] l'image présente ne correspond pas à celle qui vient d'être construite." >&2
  echo "         attendue : $APP_IMAGE_ID" >&2
  echo "         présente : $actual_id" >&2
  exit 1
fi

# --- Construction des labels de routage ----------------------------------
labels=( --label traefik.enable=true )

i=0
for domain in $APP_DOMAINS; do
  i=$((i+1))
  r="${ROUTER_PREFIX}-r${i}"
  labels+=( --label "traefik.http.routers.${r}.rule=Host(\`${domain}\`)" )
  labels+=( --label "traefik.http.routers.${r}.entrypoints=websecure" )
  labels+=( --label "traefik.http.routers.${r}.tls=true" )
done

# Routeur générique : rend le service indifférent au domaine, ce qui permet de
# basculer sur un nom dont le certificat est encore valide sans redéployer.
# Ce n'est PAS un repli TLS : le certificat suit toujours le SNI demandé.
# priority=1 garantit qu'un futur routeur d'hôte exact l'emporte.
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.rule=HostRegexp(\`^(?i)${ROUTER_PREFIX}\\..+\$\`)" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.entrypoints=websecure" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.tls=true" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.priority=1" )

labels+=( --label "traefik.http.services.${ROUTER_PREFIX}-app.loadbalancer.server.port=80" )

# --- Lancement -------------------------------------------------------------
# Les labels Docker ne sont pas modifiables à chaud : changer une règle de
# routage impose une recréation.
docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$APP_CONTAINER" \
  --network "$PROXY_NETWORK" \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  "${labels[@]}" \
  "$APP_IMAGE" \
  --root=/public --port=80 --page-fallback=/public/index.html --compression=true >/dev/null

# Aucun port publié : Traefik joint le conteneur par son nom sur le réseau proxy.
published=$(docker inspect "$APP_CONTAINER" --format '{{json .NetworkSettings.Ports}}')
case "$published" in
  *':['*) echo "[ERREUR] des ports sont publiés sur l'hôte : $published" >&2; exit 1 ;;
esac

echo "conteneur '$APP_CONTAINER' lancé — image $actual_id"
echo "domaines : $APP_DOMAINS"
