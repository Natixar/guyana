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
    # AUCUNE EXCEPTION — il y en a eu une pendant vingt-quatre heures, et elle
    # est la raison d'être de la première ligne ci-dessous.
    #
    # `/api/v1/me` a été ouverte le 3 août pour empêcher le navigateur d'ouvrir
    # sa fenêtre de mot de passe sur la page publique. Refermée le 4 : cette
    # route ne PROTÈGE pas une identité, elle la DÉCRIT, et elle la lit dans
    # l'en-tête que pose le middleware d'authentification. L'ouvrir revenait à
    # répondre « authenticated: false » à un opérateur connecté — pastille
    # « Not signed in » partout, et plus aucune barre certifiable faute
    # d'organisation émettrice.
    #
    # La fenêtre se ferme du côté de la page : `/verify/` se déclare publique et
    # n'appelle rien. Invariant correspondant dans `verify-public.bats`.
    [ "$(http_code_anon "https://$DOM/api/v1/me")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/pour")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/counts")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/ranges")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/credentials")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/sign")" = "401" ]
}

@test "avec identifiants, l'API NOMME le porteur et son organisation" {
    # LE RÉCIPROQUE DU PRÉCÉDENT, ET IL MANQUAIT. Les invariants disaient à qui
    # l'API se refuse ; aucun ne disait ce qu'elle rend à qui elle accepte. Une
    # route d'identité rendue aveugle continuait donc de répondre 200, sans que
    # rien ne s'allume : c'est exactement ce qui est arrivé le 3 août.
    #
    # Les trois brins comptent séparément. Le nom fait la pastille du bandeau ;
    # l'organisation fait le DID signataire, sans lequel `/bar/` refuse toute
    # certification ; les droits font le menu. Un seul absent est une panne
    # visible ailleurs, et loin d'ici.
    local body
    body="$(body_as agm-randy "https://$DOM/api/v1/me")"
    echo "$body" | grep -qE '"authenticated": *true'
    echo "$body" | grep -q 'agm-randy'
    echo "$body" | grep -qE '"organisation": *\{'
    echo "$body" | grep -q '"grants"'
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
    # Le jeu d'essai ERP porte l'organigramme du client : 34 départements
    # nommés. La taxonomie, elle, est ouverte — c'est le référentiel, il dit ce
    # que « 1002 » signifie et rien de l'exploitation. Les deux voisinent sous
    # `/engine/`, et c'est pour cela que l'ouverture y est par chemin exact.
    [ "$(http_code_anon "https://$DOM/engine/vectors.json")" = "401" ]
    [ "$(http_code_anon "https://$DOM/engine/taxonomy.json")" = "200" ]
}
