#!/usr/bin/env bats
# La page est servie, et c'est la bonne.

load helpers

setup() { load_env; DOM="$(primary_domain)"; }

@test "la racine répond 200 en HTTPS" {
    [ "$(http_code "https://$DOM/")" = "200" ]
}

@test "le contenu servi est celui de l'application" {
    body "https://$DOM/" | grep -q 'Natixar Gold Trace'
}

@test "les points d'entrée de l'API répondent" {
    [ "$(http_code "https://$DOM/api/v1/me")" = "200" ]
    [ "$(http_code "https://$DOM/api/v1/pour")" = "200" ]
}

@test "une URL inconnue tombe sur le repli d'application" {
    # static-web-server est configuré avec --page-fallback : toute URL inconnue
    # renvoie index.html. C'est le comportement attendu pour une application
    # à routage côté client.
    [ "$(http_code "https://$DOM/chemin-qui-nexiste-pas")" = "200" ]
}
