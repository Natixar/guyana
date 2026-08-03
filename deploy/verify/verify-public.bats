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

# LE 401 QUI OUVRE UNE FENÊTRE. Les deux cas ci-dessus suivent ce que le HTML et
# la CSS déclarent ; ils ne voient pas ce que le JAVASCRIPT demande à
# l'exécution. C'est par là que la fenêtre d'identification revenait : `nav.js`
# interroge `/api/v1/me` sur toutes les pages, Traefik y répondait 401 avec
# `www-authenticate: Basic`, et le navigateur ouvre alors sa boîte de connexion
# POUR LA REQUÊTE. La page répond 200 ; l'utilisateur voit un mot de passe
# demandé.
#
# DEUX RÉPONSES SELON CE QUE L'APPEL EST, ET LA PREMIÈRE S'EST TROMPÉE. Ouvrir
# la route a paru la réponse évidente : `/api/v1/me` « ne protège rien ». Faux —
# elle ne protège rien, mais elle DÉCRIT l'authentification, et elle la lit dans
# l'en-tête que pose le middleware. Sans middleware, plus d'en-tête : la route
# répondait « authenticated: false » à un opérateur connecté, la pastille du
# bandeau annonçait « Not signed in » partout, et plus aucune barre ne pouvait
# être certifiée faute d'organisation émettrice. Vingt-quatre heures.
#
# LA RÉPONSE JUSTE EST DE NE PAS APPELER. Une page publique n'a pas d'identité à
# afficher. `/verify/` se déclare publique, `nav.js` n'y appelle rien, et la
# route reste fermée comme le reste de l'API. Un appel qui ne doit PAS aboutir
# et qu'on garde quand même se règle en `credentials: "omit"` : il reçoit
# toujours 401 et n'ouvre rien. C'est le cas de `/engine/did/`, dont le repli
# silencieux est délibéré — s'y rabattre ferait de cette page une démonstration
# truquée.

@test "la page publique se déclare telle, et le code lit cette déclaration" {
    # LES DEUX MOITIÉS, PARCE QU'UNE SEULE NE TIENT PAS. Le marqueur dans la
    # page servie ne vaut que si le module le consulte ; la garde dans le module
    # ne vaut que si la page la porte. Retirer l'une ou l'autre rouvre la
    # fenêtre de mot de passe, et le symptôme est distant de sa cause.
    local page nav
    page="$(curl -sS --max-time 20 "https://$DOM/verify/")"
    echo "$page" | grep -q 'data-public-page'

    # Le bundle du menu, LU dans la page plutôt qu'écrit ici : son nom porte une
    # empreinte qui change à chaque construction.
    nav="$(_refs "$page" | grep -E '^/js/nav\..*\.js$' | head -1)"
    [ -n "$nav" ]
    curl -sS --max-time 20 "https://$DOM$nav" | grep -q 'data-public-page'
}

@test "les replis silencieux le restent : fermés, et sans demande de mot de passe" {
    # `/engine/did/` reste fermé — c'est l'invariant suivant — et le module qui
    # l'interroge le fait en `credentials: "omit"`. Le contrôle porte donc sur
    # la SOURCE servie : c'est là que vit la propriété, et un appel ajouté sans
    # `omit` se verrait ici.
    local page refs js
    page="$(curl -sS --max-time 20 "https://$DOM/verify/")"
    refs="$(_refs "$page" | grep -E '^/js/.*\.js$')"
    [ -n "$refs" ]

    js="$(while read -r f; do
            [ -n "$f" ] && curl -sS --max-time 20 "https://$DOM$f"
          done <<< "$refs")"

    # Le repli embarqué est bien demandé, et il l'est en silence.
    echo "$js" | grep -q '/engine/did'
    echo "$js" | grep -qE 'credentials: *"omit"'
}

@test "l'exemplaire embarqué du document DID reste fermé" {
    # LA CONTREPARTIE, et elle est aussi importante que l'ouverture. Si la page
    # publique pouvait se rabattre sur notre copie locale du document DID, elle
    # ne démontrerait plus rien : le vérificateur apporte le document de
    # l'émetteur, ou il n'y a pas de vérification. Ouvrir `/engine/` en
    # élargissant le routeur ferait disparaître l'argument sans casser un test.
    [ "$(http_code_anon "https://$DOM/engine/did/did%3Aweb%3Aguygold.com.json")" = "401" ]
    [ "$(http_code_anon "https://$DOM/engine/vectors.json")" = "401" ]
}

@test "la taxonomie est publique, et elle seule sous /engine/" {
    # L'attestation situe chaque cellule par un entier — sous-poste 1002 — et
    # nomme la version sous laquelle cet entier a un sens. Sans la table, le
    # vérificateur lit des numéros : le document cesse d'être autoportant. C'est
    # le RÉFÉRENTIEL, il ne dit rien de l'exploitation du client.
    #
    # Le chemin est EXACT : ce cas et le précédent tiennent ensemble les deux
    # moitiés de la règle, et un préfixe qui remplacerait le chemin ferait
    # tomber le précédent.
    [ "$(http_code_anon "https://$DOM/engine/taxonomy.json")" = "200" ]
    curl -sS --max-time 15 "https://$DOM/engine/taxonomy.json" | grep -q '"subPosts"'
}

@test "les pages applicatives restent fermées" {
    # L'élargissement du routeur public est la manœuvre qui risque d'emporter
    # plus que voulu. Ces trois-là le diraient.
    [ "$(http_code_anon "https://$DOM/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/register/")" = "401" ]
    [ "$(http_code_anon "https://$DOM/api/v1/counts")" = "401" ]
}
