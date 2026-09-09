// Les engagements, éprouvés depuis le signataire — et dans SON IMAGE.
//
// LES CAS NE SONT PAS ICI, ET C'EST VOULU. Ils vivent avec le module qu'ils
// éprouvent, dans `site/assets/js/commitments.test.mjs`. Ce fichier ne fait que
// les importer, ce qui suffit à les enregistrer auprès de `node:test`.
//
// POURQUOI CE POINT D'ENTRÉE EXISTE. Deux raisons, et la seconde est la bonne.
//
// La première est circonstancielle : le job `lint` nomme ses fichiers de test
// un par un, sauf ici, où il exécute `node --test "*.test.mjs"` depuis ce
// répertoire. C'est le seul glob de la chaîne d'intégration, donc le seul
// endroit où des cas peuvent entrer sans modifier `.github/workflows/`.
//
// La seconde justifierait ce fichier même sans la première. `commitTotal` est
// chargé PAR LE SIGNATAIRE au moment d'engager un total, depuis
// `../../site/assets/js/commitments.js` — le fichier source même que la page de
// vérification importe. « Un moteur, deux hôtes » ne vaut que si les deux hôtes
// exécutent réellement le même fichier, et l'image est le seul endroit où cela
// peut cesser d'être vrai : le Dockerfile copie un RÉPERTOIRE, pas une liste,
// précisément parce qu'une liste avait déjà fait perdre un module à l'image.
//
// En important les cas ici, ils tournent deux fois — depuis le dépôt dans
// `lint`, et depuis `/app` dans l'image construite par le job `ephemeral`. Si
// l'image embarquait un jour une variante du moteur d'engagement, les onze cas
// le diraient là où ils sont exécutés, et non six mois plus tard sur une
// attestation qui ne se vérifie pas.
//
// Le chemin relatif est celui du dépôt et il vaut aussi dans l'image :
// `/app/../../site/...` se réduit à `/site/...`, où le Dockerfile a copié
// l'arborescence. C'est la même mécanique que `server.mjs` emploie déjà.
import "../../site/assets/js/commitments.test.mjs";
