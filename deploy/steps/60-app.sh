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
: "${BASICAUTH_USERS:?BASICAUTH_USERS must be supplied by the launcher, from secrets/fetch.sh}"

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

# Authentification et en-têtes de sécurité, déclarés sur NOTRE conteneur : la
# configuration de Traefik appartient à un autre projet et serait écrasée.
# frame-ancestors ne pouvant pas être délivré par un <meta>, c'est ici que
# l'équivalent effectif est posé.
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-auth.basicauth.users=${BASICAUTH_USERS}" )
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-auth.basicauth.headerfield=X-Webauth-User" )
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-sec.headers.frameDeny=true" )
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-sec.headers.contentTypeNosniff=true" )
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-sec.headers.referrerPolicy=strict-origin-when-cross-origin" )
mw="${ROUTER_PREFIX}-auth@docker,${ROUTER_PREFIX}-sec@docker"

i=0
for domain in $APP_DOMAINS; do
  i=$((i+1))
  r="${ROUTER_PREFIX}-r${i}"
  labels+=( --label "traefik.http.routers.${r}.rule=Host(\`${domain}\`)" )
  labels+=( --label "traefik.http.routers.${r}.entrypoints=websecure" )
  labels+=( --label "traefik.http.routers.${r}.tls=true" )
  labels+=( --label "traefik.http.routers.${r}.middlewares=${mw}" )
  # Priorité EXPLICITE et basse. Sans elle, Traefik la déduit de la longueur de
  # la règle, et ce routeur — qui ne parle que d'un hôte — battait ceux de
  # l'API, qui parlent d'un hôte ET d'un préfixe. Le site répondant 200 pour
  # tout chemin inconnu, la panne ressemblait à un succès.
  labels+=( --label "traefik.http.routers.${r}.priority=10" )
done

# La coulée d'exemple est SERVIE PAR LE SITE, et il faut un routeur exact pour
# la lui rendre. `/api/v1` part au magasin en priorité 1000, ce qui emporte
# aussi `/api/v1/pour` — que le magasin n'expose pas, et à juste titre : c'est
# une donnée de démonstration, pas un état du cube. Le résultat en ligne était
# un 404 là où le front attend une coulée, donc « No pour awaiting
# confirmation » et un bouton de confirmation grisé.
#
# Un chemin EXACT et une priorité au-dessus du magasin, sur le modèle du
# signataire qui bat déjà le magasin sur /api/v1/sign. On n'affaiblit pas la
# règle du magasin : on nomme l'exception, et `verify-http.bats` l'affirme.
for domain in $APP_DOMAINS; do
  r="${ROUTER_PREFIX}-pour"
  labels+=( --label "traefik.http.routers.${r}.rule=Host(\`${domain}\`) && Path(\`/api/v1/pour\`)" )
  labels+=( --label "traefik.http.routers.${r}.entrypoints=websecure" )
  labels+=( --label "traefik.http.routers.${r}.tls=true" )
  labels+=( --label "traefik.http.routers.${r}.middlewares=${mw}" )
  labels+=( --label "traefik.http.routers.${r}.priority=3000" )
  break                       # le domaine de référence suffit : un seul routeur
done

# Routeur générique : rend le service indifférent au domaine, ce qui permet de
# basculer sur un nom dont le certificat est encore valide sans redéployer.
# Ce n'est PAS un repli TLS : le certificat suit toujours le SNI demandé.
# priority=1 garantit qu'un futur routeur d'hôte exact l'emporte.
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.rule=HostRegexp(\`^(?i)${ROUTER_PREFIX}\\..+\$\`)" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.entrypoints=websecure" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.tls=true" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.priority=1" )
labels+=( --label "traefik.http.routers.${ROUTER_PREFIX}-any.middlewares=${mw}" )

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
