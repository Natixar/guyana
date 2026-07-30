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
    # Une échéance courte est une panne programmée : sur ce parc les
    # certificats sont renouvelés hors bande (aucun ACME), donc l'échéance
    # est un invariant à surveiller et non une fatalité. Voir #54.
    run bash -c "echo | openssl s_client -connect '$DOM:443' -servername '$DOM' 2>/dev/null \
                 | openssl x509 -noout -checkend 1209600"
    [ "$status" -eq 0 ]
}
