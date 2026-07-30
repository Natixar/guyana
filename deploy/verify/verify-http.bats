#!/usr/bin/env bats
# La page est servie, et c'est la bonne.

load helpers

setup() { load_env; DOM="$(primary_domain)"; }

@test "la racine répond 200 en HTTPS" {
    [ "$(http_code "https://$DOM/")" = "200" ]
}

@test "le contenu servi est celui du squelette" {
    body "https://$DOM/" | grep -q 'Hello world!'
}

@test "une URL inconnue tombe sur le repli d'application" {
    # static-web-server est configuré avec --page-fallback : toute URL inconnue
    # renvoie index.html. C'est le comportement attendu pour une application
    # à routage côté client.
    [ "$(http_code "https://$DOM/chemin-qui-nexiste-pas")" = "200" ]
}
