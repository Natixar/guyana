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
# Le routage se fait par préfixe de chemin, et l'ordre des priorités compte :
# `/api/v1/sign` doit gagner contre `/api/v1`, sans quoi les requêtes de
# signature atterriraient dans le magasin — qui n'a pas de clé et répondrait 404,
# ce qui est un symptôme bien loin de sa cause.
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
secret_put() {
  local name="$1"
  docker secret rm "$name" >/dev/null 2>&1 || true
  docker secret create "$name" - >/dev/null
}

# --- le magasin : la base, aucune clé d'attestation ------------------------
docker rm -f "$STORE_CONTAINER" >/dev/null 2>&1 || true
printf '%s' "$STORE_KEY" | docker run -i --rm -v "${STORE_CONTAINER}-secrets:/s" alpine \
  sh -c 'umask 077; cat > /s/store_key.pem'

docker run -d --name "$STORE_CONTAINER" \
  --network "$DB_NETWORK" \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  -e STORE_DSN="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_CONTAINER}/${DB_NAME}" \
  -e STORE_KEY_PATH=/run/secrets/store_key.pem \
  -e STORE_PORT="$STORE_PORT" \
  -v "${STORE_CONTAINER}-secrets:/run/secrets:ro" \
  --label traefik.enable=true \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.rule=Host(\`${primary}\`) && PathPrefix(\`/api/v1\`)" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.entrypoints=websecure" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.tls=true" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.priority=10" \
  --label "traefik.http.routers.${ROUTER_PREFIX}-store.middlewares=${mw}" \
  --label "traefik.http.services.${ROUTER_PREFIX}-store.loadbalancer.server.port=${STORE_PORT}" \
  "$STORE_IMAGE" >/dev/null

# Le magasin parle à Traefik ET à la base : deuxième réseau, ajouté après coup
# parce que `docker run` n'en accepte qu'un.
docker network connect "$PROXY_NETWORK" "$STORE_CONTAINER"

# --- le signataire : une clé, aucune base ----------------------------------
docker rm -f "$SIGNER_CONTAINER" >/dev/null 2>&1 || true
printf '%s' "$SIGNER_KEY" | docker run -i --rm -v "${SIGNER_CONTAINER}-secrets:/s" alpine \
  sh -c 'umask 077; cat > /s/signer_key'
printf '%s' "$STORE_PUBKEY" | docker run -i --rm -v "${SIGNER_CONTAINER}-secrets:/s" alpine \
  sh -c 'umask 077; cat > /s/store_pubkey'

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
  --label "traefik.http.routers.${ROUTER_PREFIX}-signer.priority=20" \
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

echo "magasin sur ${PROXY_NETWORK}+${DB_NETWORK}, signataire sur ${PROXY_NETWORK} seul"
echo "routage : /api/v1/sign -> signataire (priorité 20), /api/v1 -> magasin (10)"
