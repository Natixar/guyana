#!/usr/bin/env bats
# UNE PAGE PUBLIQUE, C'EST LA PAGE **ET TOUT CE QU'ELLE CHARGE**.
#
# LE DÉFAUT QUE CES INVARIANTS EXISTENT POUR ATTRAPER. Le 3 août 2026,
# `https://guyana.natixar.pro/verify` demandait un mot de passe. La page
# répondait pourtant 200 sans identifiants, et l'invariant qui l'affirmait —
# `verify-authz.bats` — passait. Ce n'était pas la page : c'étaient le logo et
# les polices, restés derrière l'authentification. Un navigateur qui reçoit 401
# avec `WWW-Authenticate: Basic` sur un `<img>` ou une `@font-face` OUVRE LA
# FENÊTRE D'IDENTIFICATION, pour la ressource et non pour la page. Le
# vérificateur voyait donc une demande de mot de passe sur une page publique,
# ce qui est exactement le contraire de ce que cette page démontre.
#
# `curl` sur la page seule ne pouvait pas le voir : il ne suit pas les
# sous-ressources. Ces invariants les suivent — y compris les `url()` de la
# feuille de style, où vivaient les polices, absentes de tout le HTML.
#
# CE QUI EST VÉRIFIÉ EST UNE PROPRIÉTÉ, PAS UNE LISTE. Aucun chemin n'est écrit
# ici : ils sont LUS dans la page servie. Une ressource ajoutée demain par le
# gabarit sera contrôlée sans que personne y pense — et c'est la seule forme de
# ce contrôle qui vaille, puisque la faute d'origine est précisément un oubli
# d'énumération.

load helpers

setup() { load_env; DOM="$(primary_domain)"; }

# Toutes les URL absolues de même origine citées par un document.
# `src=` et `href=` pour le HTML, `url(...)` pour la CSS.
_refs() { # $1 = corps du document
    printf '%s' "$1" \
      | grep -oE '(src|href)="/[^"]*"|url\(/[^)]*\)' \
      | sed -E 's/^(src|href)="//; s/^url\(//; s/[")]+$//' \
      | sort -u
}

@test "la page de vérification répond 200 sans aucun identifiant" {
    [ "$(http_code_anon "https://$DOM/verify/")" = "200" ]
}

@test "sans barre oblique finale, la page redirige au lieu de refuser" {
    # C'est l'adresse qu'un humain tape et qu'un lien porte. Un 401 ici serait
    # indiscernable, pour lui, d'une page fermée.
    run curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOM/verify"
    [[ "$output" == 30* ]]
}

@test "tout ce que la page de vérification charge est public" {
    local page refs code fails=""
    page="$(curl -sS --max-time 20 "https://$DOM/verify/")"
    [ -n "$page" ]

    refs="$(_refs "$page")"
    [ -n "$refs" ]

    while read -r ref; do
        [ -n "$ref" ] || continue
        code="$(http_code_anon "https://$DOM$ref")"
        # 401 est le seul verdict interdit : c'est lui qui ouvre la fenêtre.
        # Un 404 serait une autre faute, que d'autres invariants attrapent.
        if [ "$code" = "401" ]; then fails="$fails$ref ($code)"$'\n'; fi
    done <<< "$refs"

    [ -z "$fails" ] || { echo "sous-ressources fermées :"; echo "$fails"; false; }
}

@test "tout ce que la feuille de style charge est public" {
    # Les polices ne figurent nulle part dans le HTML : elles sont déclarées en
    # `@font-face` dans la CSS. C'est par là que la panne est passée.
    local page css_ref css refs code fails=""
    page="$(curl -sS --max-time 20 "https://$DOM/verify/")"
    css_ref="$(_refs "$page" | grep -E '^/css/.*\.css$' | head -1)"
    [ -n "$css_ref" ]

    css="$(curl -sS --max-time 20 "https://$DOM$css_ref")"
    refs="$(_refs "$css")"

    while read -r ref; do
        [ -n "$ref" ] || continue
        code="$(http_code_anon "https://$DOM$ref")"
        if [ "$code" = "401" ]; then fails="$fails$ref ($code)"$'\n'; fi
    done <<< "$refs"

    [ -z "$fails" ] || { echo "ressources de style fermées :"; echo "$fails"; false; }
}

@test "l'exemplaire embarqué du document DID reste fermé" {
    # LA CONTREPARTIE, et elle est aussi importante que l'ouverture. Si la page
    # publique pouvait se rabattre sur notre copie locale du document DID, elle
    # ne démontrerait plus rien : le vérificateur apporte le document de
    # l'émetteur, ou il n'y a pas de vérification. Ouvrir `/engine/` en
    # élargissant le routeur ferait disparaître l'argument sans casser un test.
    [ "$(http_code_anon "https://$DOM/engine/taxonomy.json")" = "401" ]
}

@test "les pages applicatives restent fermées" {
    # L'élargissement du routeur public est la manœuvre qui risque d'emporter
    # plus que voulu. Ces trois-là le diraient.
    [ "$(http_code_anon "https://$DOM/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/register/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/counts")" = "401" ]
}
