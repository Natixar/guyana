#!/usr/bin/env bash
# deploy/steps/00-preflight.sh — assertions sur la cible. N'installe rien.
#
# Le plan initial prévoyait ici un durcissement de l'hôte et une installation du
# runtime. Sur kubb ces deux étapes n'ont pas lieu d'être : la machine préexiste,
# elle est durcie, Docker et Traefik y tournent depuis longtemps et servent
# d'autres services. Nous y sommes locataires.
#
# Ce step ne fait donc qu'affirmer les conditions dont le déploiement dépend,
# et échoue tôt si l'une manque.
#
# Exécuté sur la CIBLE.

set -euo pipefail

pf_fail=0

pf_check() { # $1 libellé, $2.. commande ou fonction
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        printf '  ok    %s\n' "$label"
    else
        printf '  ÉCHEC %s\n' "$label"
        pf_fail=1
    fi
}

# Ce qui compte n'est pas d'appartenir à un groupe nommé « docker » — il peut
# s'appeler autrement — mais de pouvoir interroger le démon sans élévation.
# On teste donc la capacité, et l'on ne rapporte le groupe que pour le journal.
pf_docker_socket() { docker info --format '{{.ServerVersion}}'; }
pf_report_group() { id -nG | tr ' ' '\n' | grep -E '^docker' || true; }

pf_traefik_running() { docker ps --format '{{.Names}}' | grep -q traefik; }

pf_disk_free() {
    local free
    free=$(df -Pk /var/lib/docker | awk 'NR==2 {print $4}')
    [ "${free:-0}" -gt 1048576 ]   # > 1 Go
}

# Un décalage d'horloge fausse les journaux et les vérifications de certificats.
# Absence de timedatectl : on ne bloque pas pour autant.
pf_clock() {
    command -v timedatectl >/dev/null || return 0
    [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ]
}

: "${PROXY_NETWORK:?PROXY_NETWORK must be set by the environment descriptor}"

echo "== préflight sur $(hostname) =="

pf_check "docker joignable sans sudo"          docker version --format '{{.Server.Version}}'
pf_check "pilotage du démon sans élévation"    pf_docker_socket
pf_check "réseau '$PROXY_NETWORK' présent"     docker network inspect "$PROXY_NETWORK"
pf_check "conteneur Traefik en marche"         pf_traefik_running
pf_check "espace disque libre > 1 Go"          pf_disk_free
pf_check "horloge synchronisée"                pf_clock

if [ "$pf_fail" -ne 0 ]; then
    echo "préflight en échec — déploiement interrompu" >&2
    exit 1
fi
printf '  info  groupes docker : %s\n' "$(pf_report_group | paste -sd, || echo aucun)"
echo "préflight ok"
