#!/usr/bin/env bats
# Isolation des données entre organisations.
#
# Prévu au plan comme la couche 2 de #39 : la base refuse, pas le code. Il n'y a
# pas encore de base, donc rien à vérifier — et c'est écrit ainsi plutôt
# qu'omis. Un fichier manquant se confond avec un oubli ; un test qui se déclare
# non applicable dit à quel moment il devra devenir applicable.

load helpers

setup() { load_env; }

@test "isolation par organisation — non applicable tant qu'il n'y a pas de base" {
    if [ -n "${DATABASE_URL:-}" ]; then
        skip "DATABASE_URL est défini : ce test doit être écrit avant la mise en service"
    fi
    # Rien à affirmer. Le jour où une base existe, ce test doit vérifier qu'un
    # rôle applicatif ne peut lire les lignes d'une autre organisation.
    [ -z "${DATABASE_URL:-}" ]
}
