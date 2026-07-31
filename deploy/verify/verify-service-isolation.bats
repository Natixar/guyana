#!/usr/bin/env bats
# La clé de signature et les données ne se rencontrent jamais dans un même
# processus — l'invariant fondateur de services/, rendu vérifiable.
#
# SPÉCIFICATION, pas test d'implémentation : ces énoncés restent vrais quelle
# que soit la manière dont steps/ les obtient, et doivent le rester si l'on
# passe de Docker à Podman.
#
# TÂCHE 4 (issue #66) — les services n'existent pas encore. Ces vérifications
# DOIVENT échouer à ce stade : une vérification qui passe avant que le sujet
# existe ne discrimine rien.

load helpers

setup() { load_env; }

remote() { ssh ${DEPLOY_SSH_OPTS} "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

@test "le signataire n'est sur aucun réseau qui joigne la base" {
    # Le cœur de l'invariant. Compromettre le signataire doit donner une clé qui
    # ne peut attester que ce qu'elle voit déjà — donc pas la base.
    run remote "docker inspect ${SIGNER_CONTAINER} \
        --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"$DB_NETWORK"* ]]
}

@test "le signataire ne joint pas PostgreSQL, constaté et non supposé" {
    # L'absence de réseau se lit dans la configuration ; l'injoignabilité se
    # constate. Les deux, parce que la première peut être vraie et la seconde
    # fausse — un réseau ajouté à chaud ne changerait pas le premier test.
    run remote "docker exec ${SIGNER_CONTAINER} \
        sh -c 'timeout 3 sh -c \"</dev/tcp/${DB_CONTAINER}/5432\" 2>&1; echo rc=\$?'"
    [[ "$output" == *"rc=1"* || "$output" == *"rc=124"* || "$output" == *"resolve"* ]]
}

@test "le magasin ne détient aucune clé de signature" {
    # La réciproque : compromettre le magasin donne des données que personne ne
    # peut attester. On cherche un secret monté, pas un fichier quelconque.
    run remote "docker inspect ${STORE_CONTAINER} --format '{{json .Mounts}}'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"signing"* ]]
    [[ "$output" != *"signer_key"* ]]
}

@test "le signataire détient bien sa clé, par un secret et non par l'image" {
    # Une clé cuite dans l'image se retrouverait dans son digest, donc dans le
    # registre, donc dans toute copie de l'image.
    run remote "docker inspect ${SIGNER_CONTAINER} --format '{{json .Mounts}}'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"signer_key"* ]]
}

@test "PostgreSQL ne publie aucun port sur l'hôte" {
    run remote "docker inspect ${DB_CONTAINER} --format '{{json .NetworkSettings.Ports}}'"
    [ "$status" -eq 0 ]
    [[ "$output" != *'":['* ]]
}

@test "PostgreSQL n'est pas routé par Traefik" {
    # L'espace de noms de Traefik est global : une étiquette suffirait à exposer
    # la base sur l'internet public sans que rien d'autre ne change.
    run remote "docker inspect ${DB_CONTAINER} --format '{{json .Config.Labels}}'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"traefik.enable=true"* ]]
}

@test "l'état de PostgreSQL vit dans un volume nommé, jamais dans un bind mount" {
    # Invariant de deploy/ : le contenu vit dans l'image, l'état dans un volume
    # nommé. Un répertoire déposé sur l'hôte ne s'atteste pas.
    run remote "docker inspect ${DB_CONTAINER} --format '{{range .Mounts}}{{.Type}} {{end}}'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"volume"* ]]
    [[ "$output" != *"bind"* ]]
}

@test "le signataire refuse de signer une extraction non signée par le magasin" {
    # Sans base, le signataire recalcule à partir de ce que le client envoie :
    # rien ne distingue cette charge d'une invention, sauf la signature du
    # magasin. C'est le seul test de ce fichier qui exerce le protocole plutôt
    # que la topologie, et il est ici parce qu'il affirme le même invariant.
    run remote "curl -sS -o /dev/null -w '%{http_code}' -X POST \
        http://${SIGNER_CONTAINER}:${SIGNER_PORT}/api/v1/sign \
        -H 'content-type: application/json' \
        --data '{\"extraction\":{\"cells\":[]},\"dispositions\":[]}'"
    [ "$status" -eq 0 ]
    # 4xx attendu : requête refusée. Un 2xx signifierait qu'on a signé une
    # extraction dont l'origine n'est pas établie.
    [[ "$output" == 4* ]]
}
