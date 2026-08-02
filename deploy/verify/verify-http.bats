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

# LE SCHÉMA DÉPLOYÉ EST-IL CELUI DE L'IMAGE ? Le 2 août 2026, `/api/v1/me` a
# répondu 500 en production : la colonne `did` n'existait pas, parce que
# `db.apply_schema` n'était appelé que par le chargeur de données. Le magasin
# l'applique désormais à son démarrage — et cet invariant le CONSTATE, plutôt
# que de faire confiance au fait qu'il soit censé le faire.
#
# Les deux routes sont choisies pour toucher les colonnes récentes : `/counts`
# filtre sur `coverage` et remonte l'arbre des entités, `/me` lit `did`. Sur un
# schéma périmé, toutes deux rendent 500.
@test "le schéma déployé porte les colonnes que l'image attend" {
    [ "$(http_code_as natixar "https://$DOM/api/v1/counts")" = "200" ]
    [ "$(http_code_as agm-randy "https://$DOM/api/v1/me")" = "200" ]
    body_as agm-randy "https://$DOM/api/v1/me" | grep -q '"did"'
}

@test "une URL inconnue tombe sur le repli d'application" {
    # static-web-server est configuré avec --page-fallback : toute URL inconnue
    # renvoie index.html. C'est le comportement attendu pour une application
    # à routage côté client.
    [ "$(http_code "https://$DOM/chemin-qui-nexiste-pas")" = "200" ]
}
