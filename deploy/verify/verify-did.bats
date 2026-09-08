#!/usr/bin/env bats
# LE DOCUMENT DID EST UNE DÉPENDANCE DE PRODUCTION, PAS UN FICHIER DE PLUS.
#
# Une attestation émise par `did:web:natixar.pro` n'est vérifiable par personne
# tant que `https://natixar.pro/.well-known/did.json` ne répond pas. Ce fichier
# n'est pas déployé par `deploy/` — il est publié par Netlify depuis
# `web/natixar.pro/` du dépôt — et c'est précisément pour cela qu'il faut le
# vérifier ici : une dépendance qu'un autre système publie est celle qu'on
# découvre absente le jour où quelqu'un vérifie une attestation.
#
# TROIS FAUTES DISTINCTES, TROIS INVARIANTS.
#   1. le document manque, ou n'est pas celui de cet émetteur ;
#   2. il est là mais illisible depuis un navigateur — pas de CORS. Le
#      vérificateur du site retombe alors sur l'exemplaire embarqué et croit
#      avoir vérifié en ligne. C'est la faute silencieuse, donc la pire ;
#   3. il est là mais ne porte pas la clé sous laquelle le signeur signe. Les
#      attestations sont orphelines, et rien ne le dit à l'émission.

load helpers

setup() {
    load_env
    # Le DID est LU dans la configuration du signeur, jamais écrit ici : le jour
    # où l'émetteur change de domaine, cet invariant doit suivre tout seul.
    DID="${SIGNER_ISSUER_DID:-${STORE_ISSUER_DID:-did:web:natixar.pro}}"
    DID_HOST="${DID#did:web:}"
    DID_HOST="${DID_HOST%%:*}"
    DID_URL="https://$DID_HOST/.well-known/did.json"
}

@test "le document DID de l'émetteur est publié" {
    run curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$DID_URL"
    [ "$output" = "200" ]
}

@test "le document DID s'annonce comme du JSON" {
    run curl -sSI --max-time 15 "$DID_URL"
    [[ "${output,,}" == *"content-type: application/did+json"* ]] \
      || [[ "${output,,}" == *"content-type: application/json"* ]]
}

@test "le document DID est lisible depuis une autre origine" {
    # Sans cet en-tête, did-source.js échoue et se rabat en silence.
    run curl -sSI --max-time 15 -H "Origin: https://$(primary_domain)" "$DID_URL"
    [[ "${output,,}" == *"access-control-allow-origin: *"* ]]
}

@test "le document DID est celui de cet émetteur" {
    run curl -sS --max-time 15 "$DID_URL"
    [[ "$output" == *"\"$DID\""* ]]
}

@test "le document DID ne contient aucune clé privée" {
    # Un JWK privé se reconnaît à son membre "d". Le contrôle coûte une ligne et
    # la faute qu'il attrape est irréversible : la clé est publiée, donc brûlée.
    run curl -sS --max-time 15 "$DID_URL"
    [[ "$output" != *'"d"'* ]]
}

@test "la clé du signeur figure dans le document publié" {
    # Propriété, pas liste : on demande au signeur sous quel identifiant il
    # signe, et on vérifie que le document l'annonce. Une rotation de clé fait
    # échouer cet invariant tant que la publication n'a pas suivi — ce qui est
    # exactement le moment où il faut le savoir.
    vm="$(curl -sS --max-time 15 "http://127.0.0.1:${SIGNER_PORT:-8081}/api/v1/me" \
          | grep -oE 'did:web:[^"]+#[^"]+' | head -1)" || skip "signeur injoignable"
    [ -n "$vm" ] || skip "le signeur n'annonce pas son identifiant de clé"
    run curl -sS --max-time 15 "$DID_URL"
    [[ "$output" == *"$vm"* ]]
}

# LA PAGE DOIT POUVOIR ALLER CHERCHER LE DOCUMENT, ET RIEN NE LE DISAIT.
#
# Le document est publié, lisible depuis n'importe quelle origine, et pourtant
# la page de vérification ne pouvait pas le lire : sa propre politique de
# sécurité portait `connect-src 'self'`. La requête était bloquée dans le
# navigateur du vérificateur — donc là où nous ne la voyons pas — et
# `did-source.js` se rabattait sur le dépôt manuel du fichier.
#
# CE MODE DE PANNE NE SE VOIT NULLE PART AILLEURS. Les cinq invariants
# ci-dessus interrogent le document depuis `curl`, qui n'applique aucune CSP :
# ils passent tous pendant que la démonstration est dégradée. Le repli, lui,
# fonctionne — la page reste utilisable, elle annonce honnêtement d'où vient le
# document — de sorte que rien ne crie. C'est exactement la forme de panne que
# ce dépôt attrape le moins bien : celle qui laisse tout en apparence de marche.
#
# L'invariant lit la politique RÉELLEMENT SERVIE et vérifie qu'elle nomme l'URL
# que `did-source.js` va chercher. Il échoue si quelqu'un resserre `connect-src`
# sans savoir ce qu'il coupe.
@test "la page de vérification a le droit d'aller lire le document DID" {
    local csp
    csp="$(curl -sS --max-time 15 "https://$(primary_domain)/verify/" \
           | grep -o 'content="default-src[^"]*"' | head -1)"
    [ -n "$csp" ] || { echo "aucune CSP trouvée dans la page servie" >&2; return 1; }

    # L'URL exacte, ou le domaine : les deux formes autorisent la lecture. On
    # n'impose pas laquelle — c'est une décision de resserrement, pas un
    # invariant — mais l'une des deux doit être là.
    [[ "$csp" == *"$DID_URL"* ]] || [[ "$csp" == *"https://$DID_HOST"* ]] || {
        echo "connect-src n'autorise pas $DID_URL" >&2
        echo "politique servie : $csp" >&2
        return 1
    }
}
