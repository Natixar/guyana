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

# Identifiants de vérification. Jamais dans le dépôt : fournis par
# l'environnement, ou lus dans le fichier local ignoré par git.
_auth() {
    if [ -n "${VERIFY_AUTH:-}" ]; then printf -- '-u\n%s\n' "$VERIFY_AUTH"; return; fi
    local f="${BATS_TEST_DIRNAME}/../secrets/local/credentials.txt"
    [ -r "$f" ] || return 0
    awk '$1=="demo"{print "-u"; print $1":"$2; exit}' "$f"
}

curl_auth() { # $@ : arguments curl
    local -a a=(); mapfile -t a < <(_auth)
    curl -sS --max-time 15 "${a[@]}" "$@"
}

http_code() { # $1 url  [$2.. options curl]
    curl_auth -o /dev/null -w '%{http_code}' "${@:2}" "$1" 2>/dev/null
}

# Sans identifiants : sert à vérifier que le proxy refuse bien.
http_code_anon() {
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null
}

tls_verify_result() { # $1 url
    curl -sS -o /dev/null -w '%{ssl_verify_result}' --max-time 15 "$1" 2>/dev/null
}

body() { curl_auth "$1" 2>/dev/null; }
