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
# LE DOCUMENT QUI POINTE VERS LES EMPREINTES DOIT ÊTRE FRAIS, SANS QUOI LES
# EMPREINTES NE SERVENT À RIEN.
#
# Hugo nomme chaque module par l'empreinte de son contenu, et le serveur
# statique les met en cache un an — c'est correct, une URL qui change à chaque
# modification ne peut pas devenir périmée. Mais il met aussi en cache le HTML
# pendant 24 heures, et le HTML est le SEUL document dont l'URL ne change
# jamais. Un navigateur qui a chargé la page hier la ressert aujourd'hui, avec
# les empreintes d'hier, et charge donc les modules d'hier depuis son cache
# d'un an.
#
# Constaté le 2 août : la page d'auto-test a exécuté un moteur de la veille
# contre des vecteurs du jour, et vingt et un cas sont tombés. Le serveur
# servait le bon code ; le navigateur ne l'a jamais demandé. C'est exactement
# le genre de panne qui se produirait devant la caméra.
#
# `no-cache` ne veut pas dire « ne garde rien » : il veut dire « revalide avant
# de servir ». Avec l'ETag, une ressource inchangée coûte un 304 et zéro octet.
# Appliqué à tout ce que le site sert plutôt qu'au seul HTML : Traefik décide
# par routeur et non par type de contenu, et un aller-retour conditionnel par
# module sur un site de vingt fichiers est un prix qu'on paie sans le voir. La
# raffiner par chemin serait une optimisation, pas une correction.
#
# UN SEUL ÉMETTEUR DE CET EN-TÊTE, et c'est le complément du 2 août. Le serveur
# statique en pose un de son côté, déduit du type de contenu — 24 heures pour le
# HTML, un an pour le reste. Deux autorités pour un même en-tête est un état où
# la question « qui gagne ? » a une réponse, mais où personne ne l'a décidée :
# elle dépend de l'ordre dans lequel Traefik écrit, et donc d'une version de
# Traefik. Le conteneur est donc lancé avec `--cache-control-headers=false`
# (voir plus bas) : le serveur n'en pose plus aucun, celui-ci est le seul, et le
# comportement se lit ici en entier.
labels+=( --label "traefik.http.middlewares.${ROUTER_PREFIX}-fresh.headers.customResponseHeaders.Cache-Control=no-cache" )
mw="${ROUTER_PREFIX}-auth@docker,${ROUTER_PREFIX}-sec@docker,${ROUTER_PREFIX}-fresh@docker"

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

# LA PAGE DE VÉRIFICATION EST PUBLIQUE, et c'est une correction de fond.
#
# Elle existe pour démontrer qu'un acheteur, un affineur ou un auditeur peut
# contrôler une attestation SANS avoir à nous faire confiance. Lui demander un
# mot de passe sur notre plateforme contredisait cet énoncé : on ne peut pas
# prouver qu'on est superflu derrière une porte dont on tient la clé.
#
# Ce qui devient public : la page, ses feuilles de style et ses modules. Ce sont
# des fichiers statiques, pas des secrets — et ils sont déjà servis à quiconque
# détient un compte. Ce qui reste FERMÉ : toutes les pages applicatives, toute
# l'API, et `/engine/` — donc l'exemplaire embarqué du document DID. Sans lui,
# la page publique ne peut pas se rabattre sur une copie locale : le
# vérificateur apporte le document de l'émetteur, ou il n'y a pas de
# vérification. C'est exactement ce que la démonstration doit montrer.
for domain in $APP_DOMAINS; do
  r="${ROUTER_PREFIX}-public"
  labels+=( --label "traefik.http.routers.${r}.rule=Host(\`${domain}\`) && (PathPrefix(\`/verify\`) || PathPrefix(\`/css/\`) || PathPrefix(\`/js/\`) || Path(\`/favicon.svg\`))" )
  labels+=( --label "traefik.http.routers.${r}.entrypoints=websecure" )
  labels+=( --label "traefik.http.routers.${r}.tls=true" )
  # Les en-têtes de sécurité restent ; seule l'authentification saute.
  labels+=( --label "traefik.http.routers.${r}.middlewares=${ROUTER_PREFIX}-sec@docker,${ROUTER_PREFIX}-fresh@docker" )
  labels+=( --label "traefik.http.routers.${r}.priority=2500" )
  break
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
  --root=/public --port=80 --page-fallback=/public/index.html --compression=true \
  --cache-control-headers=false >/dev/null

# Aucun port publié : Traefik joint le conteneur par son nom sur le réseau proxy.
published=$(docker inspect "$APP_CONTAINER" --format '{{json .NetworkSettings.Ports}}')
case "$published" in
  *':['*) echo "[ERREUR] des ports sont publiés sur l'hôte : $published" >&2; exit 1 ;;
esac

echo "conteneur '$APP_CONTAINER' lancé — image $actual_id"
echo "domaines : $APP_DOMAINS"
