#!/usr/bin/env bash
# Le réseau de données et PostgreSQL.
#
# Ce réseau est à NOUS, contrairement à `proxy` qui appartient au projet Compose
# de Traefik. C'est aussi le réseau que le signataire ne doit jamais joindre :
# l'invariant fondateur de services/ se réduit ici à une question
# d'appartenance, et `verify-service-isolation.bats` la pose deux fois.
#
# Trois règles de deploy/ s'appliquent sans exception :
#   - aucun port publié : la base n'est joignable que sur ce réseau ;
#   - aucune étiquette Traefik : son espace de noms est global, et une seule
#     étiquette suffirait à publier la base sur l'internet ;
#   - l'état dans un volume NOMMÉ, jamais un répertoire de l'hôte, qui ne
#     s'atteste pas et ne se déploie pas par digest.
set -euo pipefail

: "${DB_CONTAINER:?}" "${DB_NETWORK:?}" "${DB_IMAGE:?}" "${DB_VOLUME:?}"
: "${DB_NAME:?}" "${DB_USER:?}"
: "${DB_PASSWORD:?DB_PASSWORD doit venir du lanceur, via secrets/fetch.sh}"

if ! docker network inspect "$DB_NETWORK" >/dev/null 2>&1; then
  docker network create --internal "$DB_NETWORK" >/dev/null
  echo "réseau '$DB_NETWORK' créé (interne : aucune route sortante)"
else
  echo "réseau '$DB_NETWORK' présent"
fi

if ! docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  docker volume create "$DB_VOLUME" >/dev/null
  echo "volume '$DB_VOLUME' créé"
else
  echo "volume '$DB_VOLUME' présent — les données sont conservées"
fi

# Recréé sans toucher au volume : le conteneur est jetable, l'état ne l'est pas.
docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$DB_CONTAINER" \
  --network "$DB_NETWORK" \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -v "$DB_VOLUME:/var/lib/postgresql/data" \
  --health-cmd "pg_isready -U $DB_USER -d $DB_NAME" \
  --health-interval 5s --health-retries 12 \
  "$DB_IMAGE" >/dev/null

published=$(docker inspect "$DB_CONTAINER" --format '{{json .NetworkSettings.Ports}}')
case "$published" in
  *':['*)
    echo "[ERREUR] la base publie des ports sur l'hôte : $published" >&2
    exit 1 ;;
esac

# On attend l'état sain plutôt que de dormir : le magasin échouerait sinon à la
# première requête, et le diagnostic porterait sur le magasin.
for _ in $(seq 60); do
  state=$(docker inspect "$DB_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)
  [ "$state" = healthy ] && break
  sleep 1
done
[ "${state:-}" = healthy ] || {
  echo "[ERREUR] PostgreSQL n'est pas devenu sain." >&2
  echo "         docker logs $DB_CONTAINER" >&2
  exit 1
}

echo "PostgreSQL prêt (volume $DB_VOLUME, réseau $DB_NETWORK, aucun port publié)"
