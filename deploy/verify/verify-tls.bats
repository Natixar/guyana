#!/usr/bin/env bats
# TLS est valide et rien n'est servi en clair.

load helpers

setup() { load_env; DOM="$(primary_domain)"; }

@test "le certificat servi est valide" {
    [ "$(tls_verify_result "https://$DOM/")" = "0" ]
}

@test "HTTP redirige en permanence vers HTTPS" {
    run curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "http://$DOM/"
    [[ "$output" == 301*"https://$DOM/"* ]]
}

@test "le certificat n'expire pas dans les 14 jours" {
    # Une échéance courte est une panne programmée. Les certificats sont
    # renouvelés par ACME via le résolveur déclaré sur nos routeurs ; un
    # renouvellement qui ne se produit pas ne dit rien de lui-même, et c'est
    # l'échéance qui le révèle. Voir #54.
    run bash -c "echo | openssl s_client -connect '$DOM:443' -servername '$DOM' 2>/dev/null \
                 | openssl x509 -noout -checkend 1209600"
    [ "$status" -eq 0 ]
}

# LE CERTIFICAT PAR DÉFAUT DE TRAEFIK EST UN SUCCÈS QUI RESSEMBLE À UN SUCCÈS.
#
# Un routeur déclaré `tls=true` SANS `tls.certresolver` ne demande aucun
# certificat : Traefik en sert un, auto-signé, portant « TRAEFIK DEFAULT CERT ».
# Le service répond, l'application fonctionne, tous les invariants qui lisent un
# code HTTP passent — et le navigateur ouvre une alerte de sécurité en pleine
# démonstration. C'est exactement le mode de panne constaté le 3 août 2026.
#
# `curl` refuserait la connexion, donc « le certificat servi est valide » le
# détecterait aussi ; mais il le dirait sous une forme — « handshake échoué » —
# qui n'oriente vers rien. Celui-ci nomme la cause.
@test "le certificat vient d'une autorité, pas du repli interne de Traefik" {
    run bash -c "echo | openssl s_client -connect '$DOM:443' -servername '$DOM' 2>/dev/null \
                 | openssl x509 -noout -issuer"
    [ "$status" -eq 0 ]
    [[ "$output" != *"TRAEFIK DEFAULT CERT"* ]]

    # Auto-signé : l'émetteur est le sujet. Une autorité publique diffère
    # toujours du nom qu'elle certifie. Les préfixes `issuer=` et `subject=`
    # sont retirés, sans quoi les deux chaînes diffèrent toujours et le contrôle
    # passerait sur n'importe quoi.
    local pem issuer subject
    pem="$(echo | openssl s_client -connect "$DOM:443" -servername "$DOM" 2>/dev/null)"
    issuer="$(printf '%s' "$pem"  | openssl x509 -noout -issuer  | sed 's/^issuer=//')"
    subject="$(printf '%s' "$pem" | openssl x509 -noout -subject | sed 's/^subject=//')"
    [ -n "$issuer" ]
    [ "$issuer" != "$subject" ]
}
