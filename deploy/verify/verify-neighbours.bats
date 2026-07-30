#!/usr/bin/env bats
# Non-régression des voisins.
#
# C'est la vérification qui compte le plus, et elle ne figurait pas au plan
# initial : elle est née de la pratique. Sur une infrastructure partagée, le
# risque n'est pas que notre déploiement échoue — il est qu'il casse autre
# chose. À ne jamais sauter.

load helpers

setup() { load_env; }

@test "les services voisins répondent comme avant" {
    local failures=0
    for entry in $NEIGHBOURS; do
        local host="${entry%%=*}" expected="${entry##*=}" got
        got="$(http_code "https://$host/")"
        if [ "$got" != "$expected" ]; then
            echo "voisin cassé : $host attendait $expected, obtenu $got" >&2
            failures=$((failures+1))
        fi
    done
    [ "$failures" -eq 0 ]
}
