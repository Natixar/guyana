#!/usr/bin/env bats
# Une requête sans identifiants est refusée par le proxy.
#
# Prévu au plan dès le départ, et devenu testable le jour où le déploiement est
# passé derrière BasicAuth. C'est l'invariant qui empêche qu'un déploiement de
# démonstration devienne accessible à qui passe.

load helpers

setup() { load_env; DOM="$(primary_domain)"; }

@test "sans identifiants, le proxy refuse" {
    [ "$(http_code_anon "https://$DOM/")" = "401" ]
}

@test "sans identifiants, aucun point d'entrée de l'API ne répond" {
    [ "$(http_code_anon "https://$DOM/api/v1/me")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/pour")" = "401" ]
}

@test "un mot de passe erroné est refusé" {
    run curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -u "demo:mauvais" "https://$DOM/"
    [ "$output" = "401" ]
}

@test "les en-têtes de sécurité sont posés par le proxy" {
    run curl_auth -I "https://$DOM/"
    [[ "$output" == *"X-Frame-Options: DENY"* || "$output" == *"x-frame-options: DENY"* ]]
    [[ "${output,,}" == *"x-content-type-options: nosniff"* ]]
}
