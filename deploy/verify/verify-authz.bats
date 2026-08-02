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

# LA PAGE DE VÉRIFICATION EST PUBLIQUE, ET RIEN D'AUTRE NE L'EST.
#
# Elle existe pour démontrer qu'un acheteur ou un auditeur contrôle une
# attestation sans avoir à nous faire confiance ; la mettre derrière un mot de
# passe contredisait l'énoncé. L'ouverture est donc voulue — et c'est
# exactement pourquoi elle doit être bornée par un invariant : une exception
# d'authentification qui s'élargit sans qu'on le voie est la façon dont ces
# choses tournent mal.
@test "la page de vérification s'ouvre sans identifiants" {
    [ "$(http_code_anon "https://$DOM/verify/")" = "200" ]
}

@test "l'ouverture ne déborde pas sur le reste du site" {
    # Les pages applicatives, l'API, et l'exemplaire embarqué du document DID.
    # Ce dernier compte autant que les autres : servi publiquement, la page
    # pourrait se rabattre en silence sur une copie locale de la clé, et la
    # démonstration deviendrait truquée.
    [ "$(http_code_anon "https://$DOM/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/register/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/quality/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/counts")" = "401" ]
    [ "$(http_code_anon "https://$DOM/engine/erp-fixture.json")" = "401" ]
}
