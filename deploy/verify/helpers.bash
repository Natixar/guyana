# deploy/verify/helpers.bash — socle commun des vérifications.
#
# Ces vérifications sont une SPÉCIFICATION, pas des tests d'implémentation.
# Elles affirment des invariants du système en marche, vrais quelle que soit la
# manière dont steps/ les obtient, et doivent rester vrais si l'on passe de
# Docker à Podman. C'est ce qui les rend indépendantes de steps/ (CI A4 du plan).
#
# Elles ne dépendent que d'un descripteur d'environnement, jamais de la topologie.

_env_file() {
    echo "${VERIFY_ENV_FILE:-${BATS_TEST_DIRNAME}/../inventory/hosts.d/${VERIFY_ENV:-kubb}.env}"
}

load_env() {
    local f; f="$(_env_file)"
    [ -f "$f" ] || { echo "descripteur introuvable : $f" >&2; return 1; }
    # shellcheck source=/dev/null
    . "$f"
}

# Premier domaine déclaré = domaine de référence.
primary_domain() { load_env >/dev/null; echo "$APP_DOMAINS" | awk '{print $1}'; }

http_code() { # $1 url  [$2 option curl supplémentaire]
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${@:2}" "$1" 2>/dev/null
}

tls_verify_result() { # $1 url
    curl -sS -o /dev/null -w '%{ssl_verify_result}' --max-time 15 "$1" 2>/dev/null
}

body() { curl -sS --max-time 15 "$1" 2>/dev/null; }
