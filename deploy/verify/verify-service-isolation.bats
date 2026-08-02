#!/usr/bin/env bats
# La clé de signature et les données ne se rencontrent jamais dans un même
# processus — l'invariant fondateur de services/, rendu vérifiable.
#
# SPÉCIFICATION, pas test d'implémentation : ces énoncés restent vrais quelle
# que soit la manière dont steps/ les obtient, et doivent le rester si l'on
# passe de Docker à Podman.
#
# Ces vérifications interrogent la CIBLE, jamais le lanceur : elles ne
# connaissent que le descripteur d'environnement. L'étiquette d'image, en
# particulier, se lit sur le conteneur qui tourne — la dériver du commit
# reproduirait ici une règle qui appartient à deploy.sh, et les deux
# divergeraient au premier changement de convention.

load helpers

setup() { load_env; }

remote() { ssh ${DEPLOY_SSH_OPTS} "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

# L'image réellement en service, lue sur la cible.
running_image() { remote "docker inspect $1 --format '{{.Config.Image}}'"; }

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
    #
    # La sonde passe par Node et non par `</dev/tcp/...` : cette redirection est
    # une extension de BASH, absente des deux images. Elle constatait l'absence
    # de bash et l'appelait injoignabilité.
    run remote "docker exec ${SIGNER_CONTAINER} node -e \"
        const net = require('node:net');
        const s = net.connect(${DB_PORT:-5432}, '${DB_CONTAINER}');
        s.setTimeout(3000);
        s.on('connect', () => { console.log('JOIGNABLE'); process.exit(0); });
        s.on('error',   (e) => { console.log('REFUSE ' + e.code); process.exit(0); });
        s.on('timeout', ()  => { console.log('REFUSE TIMEOUT'); process.exit(0); });
    \""
    [ "$status" -eq 0 ]
    [[ "$output" == *"REFUSE"* ]]
    [[ "$output" != *"JOIGNABLE"* ]]
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
    # registre, donc dans toute copie de l'image. Ce qui s'affirme est donc le
    # MONTAGE — un volume en lecture seule sur /run/secrets — et non un nom de
    # fichier, que `docker inspect` ne montre pas : il nomme le volume.
    run remote "docker inspect ${SIGNER_CONTAINER} --format '{{json .Mounts}}'"
    [ "$status" -eq 0 ]
    [[ "$output" == *'"Destination":"/run/secrets"'* ]]
    [[ "$output" == *'"RW":false'* ]]

    # Et la clé y est réellement lisible PAR LE SERVICE : un secret écrit par
    # root en 0600 laisse le conteneur redémarrer en boucle sur EACCES, ce qui
    # ressemble à une clé mal formée.
    run remote "docker exec ${SIGNER_CONTAINER} head -c 1 /run/secrets/signer_key"
    [ "$status" -eq 0 ]
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
    # Depuis un conteneur du réseau proxy, et non depuis l'hôte : le nom d'un
    # conteneur ne se résout que dans le réseau Docker, et interroger depuis
    # l'hôte mesurait la résolution DNS de l'hôte.
    image="$(running_image "${SIGNER_CONTAINER}")"
    run remote "docker run --rm --network ${PROXY_NETWORK} ${image} node -e \"
        const r = await fetch('http://${SIGNER_CONTAINER}:${SIGNER_PORT}/api/v1/sign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ extraction: { cells: [] }, dispositions: [] }),
        });
        console.log('HTTP ' + r.status);
    \""
    [ "$status" -eq 0 ]
    # 4xx attendu : requête refusée. Un 2xx signifierait qu'on a signé une
    # extraction dont l'origine n'est pas établie.
    [[ "$output" == *"HTTP 4"* ]]
}

@test "l'API est servie par les services, jamais par le site" {
    # Le site répond 200 avec sa page d'accueil pour TOUT chemin inconnu. Une
    # erreur de routage y prend donc l'apparence d'un succès, et c'est
    # exactement ce qui est arrivé : Traefik, faute de priorité explicite, la
    # calcule sur la longueur de la règle, et le routeur du site — qui ne parle
    # que d'un hôte — battait ceux de l'API.
    #
    # On n'affirme pas la priorité, qui est un moyen : on affirme que /api/v1
    # ne renvoie pas de HTML, qui est la propriété.
    run curl_auth -o /dev/null -w '%{content_type}' \
        "https://$(primary_domain)/api/v1/credentials/index"
    [ "$status" -eq 0 ]
    [[ "$output" != *"text/html"* ]]
}
