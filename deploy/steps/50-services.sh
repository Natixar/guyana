#!/usr/bin/env bash
# Le magasin et le signataire — deux processus qui ne se font pas confiance.
#
#   LA CLÉ DE SIGNATURE ET LES DONNÉES NE SE RENCONTRENT JAMAIS.
#
# Ce script est l'endroit où cet invariant devient une topologie plutôt qu'une
# intention, et il tient en trois lignes :
#
#   - le magasin est sur `proxy` ET `$DB_NETWORK` ;
#   - le signataire est sur `proxy` SEULEMENT ;
#   - le signataire reçoit la clé publique du magasin, jamais la privée.
#
# LE ROUTAGE PAR PRIORITÉ, ET POURQUOI ELLES SONT SI GRANDES.
#
# Traefik, faute de priorité explicite, la CALCULE sur la longueur de la règle.
# Le routeur du site porte `Host(\`guyana.natixar.pro\`)`, soit une trentaine de
# caractères, donc une priorité d'une trentaine : des valeurs de 10 et 20 se
# faisaient battre par un routeur qui ne les mentionnait même pas. Le magasin
# n'a jamais été joignable depuis le navigateur, et personne ne l'a vu parce que
# le site répond 200 avec sa page d'accueil pour tout chemin inconnu — une
# erreur de routage prenait l'apparence d'un succès.
#
# Les priorités sont donc explicites et TRÈS au-dessus de toute longueur de
# règle plausible. `/api/v1/sign` doit en outre gagner contre `/api/v1`, sans
# quoi les requêtes de signature atterriraient dans le magasin — qui n'a pas de
# clé et répondrait 404, un symptôme loin de sa cause.
set -euo pipefail

: "${SIGNER_CONTAINER:?}" "${SIGNER_IMAGE:?}" "${SIGNER_PORT:?}"
: "${STORE_CONTAINER:?}" "${STORE_IMAGE:?}" "${STORE_PORT:?}"
: "${PROXY_NETWORK:?}" "${DB_NETWORK:?}" "${DB_CONTAINER:?}" "${DB_NAME:?}" "${DB_USER:?}"
: "${ROUTER_PREFIX:?}" "${APP_DOMAINS:?}"
: "${DB_PASSWORD:?}" "${SIGNER_KEY:?}" "${STORE_KEY:?}" "${STORE_PUBKEY:?}"

primary=$(printf '%s\n' $APP_DOMAINS | head -1)
mw="${ROUTER_PREFIX}-auth@docker,${ROUTER_PREFIX}-sec@docker"

# Les secrets arrivent par stdin et ne touchent jamais le disque de la cible.
# Un fichier déposé sur l'hôte survivrait au conteneur et à notre attention.
#
# Écrits DEPUIS L'IMAGE QUI LES LIRA, et non depuis une image quelconque. Les
# conteneurs tournent sans privilège — `node` pour le signataire, `store` pour
# le magasin — et un secret écrit en 0600 par root est illisible pour eux : le
# service redémarre en boucle sur EACCES, ce qui ressemble à une clé mal formée
# bien plus qu'à un problème de permissions.
#
# Passer par l'image du consommateur laisse le nom d'utilisateur se résoudre là
# où il existe. Le Dockerfile reste ainsi la seule source de vérité sur l'UID :
# le changer là-bas n'oblige à rien changer ici.
secret_put() { # $1 = image, $2 = utilisateur, $3 = volume, $4 = nom de fichier
  docker run -i --rm --user 0 -v "$3:/s" "$1" \
    sh -c "umask 077; cat > /s/$4 && chown \$(id -u $2):\$(id -g $2) /s/$4 && chmod 400 /s/$4"
}

# La chaîne de connexion en forme MOT-CLÉ, jamais en URI.
#
# Un mot de passe engendré au hasard contient tôt ou tard « / » ou « + ». Dans
# `postgresql://user:pass@hote/base`, un « / » termine la partie utilisateur et
# décale tout ce qui suit : la connexion échoue sur « Servname not supported »,
# un message qui ne parle ni de mot de passe ni d'échappement. C'est arrivé.
#
# La forme mot-clé n'a pas de grammaire d'URI à respecter — seulement des
# guillemets simples, qu'on échappe ici.
escaped_password=$(printf '%s' "$DB_PASSWORD" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g")
store_dsn="host=${DB_CONTAINER} user=${DB_USER} dbname=${DB_NAME} password='${escaped_password}'"

# --- le magasin : la base, aucune clé d'attestation ------------------------
docker rm -f "$STORE_CONTAINER" >/dev/null 2>&1 || true
printf '%s' "$STORE_KEY" | secret_put "$STORE_IMAGE" store "${STORE_CONTAINER}-secrets" store_key.pem

docker run -d --name "$STORE_CONTAINER" \
  --network "$DB_NETWORK" \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  -e STORE_DSN="$store_dsn" \
  -e STORE_KEY_PATH=/run/secrets/store_key.pem \
  -e STORE_PORT="$STORE_PORT" \
  -v "${STORE_CONTAINER}-secrets:/run/secrets:ro" \
  --label traefik.enable=true \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.rule=Host(\`${primary}\`) && PathPrefix(\`/api/v1\`)" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.entrypoints=websecure" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.tls=true" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.priority=1000" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.middlewares=${mw}" \
  --label "traefik.http.services.${ROUTER_PREFIX}-store.loadbalancer.server.port=${STORE_PORT}" \
  "$STORE_IMAGE" >/dev/null

# Le magasin parle à Traefik ET à la base : deuxième réseau, ajouté après coup
# parce que `docker run` n'en accepte qu'un.
docker network connect "$PROXY_NETWORK" "$STORE_CONTAINER"

# --- le signataire : une clé, aucune base ----------------------------------
docker rm -f "$SIGNER_CONTAINER" >/dev/null 2>&1 || true
printf '%s' "$SIGNER_KEY"   | secret_put "$SIGNER_IMAGE" node "${SIGNER_CONTAINER}-secrets" signer_key
printf '%s' "$STORE_PUBKEY" | secret_put "$SIGNER_IMAGE" node "${SIGNER_CONTAINER}-secrets" store_pubkey

docker run -d --name "$SIGNER_CONTAINER" \
  --network "$PROXY_NETWORK" \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  -e SIGNER_KEY_PATH=/run/secrets/signer_key \
  -e STORE_PUBKEY_PATH=/run/secrets/store_pubkey \
  -e SIGNER_PORT="$SIGNER_PORT" \
  -v "${SIGNER_CONTAINER}-secrets:/run/secrets:ro" \
  --label traefik.enable=true \
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.rule=Host(\`${primary}\`) && PathPrefix(\`/api/v1/sign\`)" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.entrypoints=websecure" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.tls=true" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.priority=2000" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.middlewares=${mw}" \
  --label "traefik.http.services.${ROUTER_PREFIX}-signer.loadbalancer.server.port=${SIGNER_PORT}" \
  "$SIGNER_IMAGE" >/dev/null

# --- l'invariant, constaté et non supposé ----------------------------------
# L'absence de réseau se LIT dans la configuration ; l'injoignabilité se
# CONSTATE. La première peut être vraie pendant que la seconde est fausse — un
# réseau attaché à chaud ne changerait pas la première réponse.
nets=$(docker inspect "$SIGNER_CONTAINER" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
case " $nets " in
  *" $DB_NETWORK "*)
    echo "[ERREUR] le signataire est sur le réseau de la base — l'invariant est rompu." >&2
    echo "         docker network disconnect $DB_NETWORK $SIGNER_CONTAINER" >&2
    exit 1 ;;
esac

for c in "$STORE_CONTAINER" "$SIGNER_CONTAINER"; do
  published=$(docker inspect "$c" --format '{{json .NetworkSettings.Ports}}')
  case "$published" in
    *':['*) echo "[ERREUR] $c publie des ports : $published" >&2; exit 1 ;;
  esac
done

# Un service qui redémarre en boucle se constate ici. Sans ce contrôle, le
# déploiement s'annonce réussi et la panne n'apparaît qu'à la vérification
# suivante — un secret illisible ressemble alors à une clé mal formée.
sleep 3
for c in "$STORE_CONTAINER" "$SIGNER_CONTAINER"; do
  state=$(docker inspect "$c" --format '{{.State.Status}}')
  if [ "$state" != running ]; then
    echo "[ERREUR] $c n'est pas en marche (état : $state)" >&2
    docker logs --tail 15 "$c" >&2 2>&1 || true
    exit 1
  fi
done

echo "magasin sur ${PROXY_NETWORK}+${DB_NETWORK}, signataire sur ${PROXY_NETWORK} seul"
echo "routage : /api/v1/sign -> signataire (2000), /api/v1 -> magasin (1000), reste -> site"
