#!/usr/bin/env bats
# Rien n'est joignable hors du proxy — D3 rendue vérifiable.

load helpers

setup() { load_env; }

@test "le conteneur applicatif ne publie aucun port sur l'hôte" {
    run ssh $DEPLOY_SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" \
        "docker inspect ${ROUTER_PREFIX}-hello --format '{{json .NetworkSettings.Ports}}'"
    [ "$status" -eq 0 ]
    # Une liaison publiée apparaîtrait sous la forme "80/tcp":[{...}]
    [[ "$output" != *'":['* ]]
}

@test "le conteneur est bien sur le réseau du proxy" {
    # Le fournisseur docker de Traefik est épinglé sur ce réseau : un conteneur
    # ailleurs serait découvert mais resterait injoignable.
    run ssh $DEPLOY_SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" \
        "docker inspect ${ROUTER_PREFIX}-hello --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'"
    [[ "$output" == *"$PROXY_NETWORK"* ]]
}
