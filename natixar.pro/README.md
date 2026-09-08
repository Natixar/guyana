# natixar.pro — ce que Netlify publie

Ce répertoire est la source du site servi sur `https://natixar.pro/`. Il était
tenu hors dépôt, dans un dossier local ; il est ici pour que son contenu soit
versionné, relu et déployé comme le reste.

## Le répertoire de publication est `natixar.pro/public`

C'est la valeur à donner à Netlify (projet `heroic-dango-aec695`). **Aucune
commande de construction** : Netlify clone le dépôt et sert ce répertoire tel
quel. C'est pourquoi `public/.well-known/did.json` est **versionné** bien qu'il
soit engendré — un fichier produit par une étape que Netlify n'exécute pas doit
exister dans le dépôt, sans quoi il n'existe nulle part.

Le script et son test restent **hors** de `public/` : le lien profond fonctionne
sur ce site, et tout fichier placé dans le répertoire publié est servi à qui en
devine le chemin.

```
natixar.pro/
├── README.md          ce fichier
├── build.mjs          engendre le document DID depuis la clé du signataire
├── build.test.mjs     ce que le document doit satisfaire
└── public/            ← RÉPERTOIRE DE PUBLICATION NETLIFY
    ├── index.html     redirection vers www.natixar.com
    ├── _headers       CORS et fraîcheur du document DID
    └── .well-known/
        └── did.json   engendré, versionné, jamais édité à la main
```

## Ce que le site contient

**`index.html`** — 388 octets qui redirigent vers `www.natixar.com`. Le domaine
n'héberge pas de site : il porte une redirection, et désormais une identité.

**`.well-known/did.json`** — le document DID de `did:web:natixar.pro`, émetteur
déclaré de toute la chaîne de signature (`services/store/app.py`,
`services/signer/server.mjs`). Un vérificateur y lit la clé publique qui lui
permet de contrôler une attestation **sans rien nous demander**. C'est le seul
fichier de ce dépôt dont l'absence rend la démonstration invérifiable.

## Régénérer le document

```bash
node natixar.pro/build.mjs           # écrit public/.well-known/did.json
node natixar.pro/build.mjs --check   # sort 1 si le fichier n'est pas à jour
node --test natixar.pro/build.test.mjs
```

Le script lit la clé du signataire dans `deploy/secrets/local/signer_key.jwk`
(hors dépôt) et n'en publie que la partie publique. Il lit **les mêmes variables
d'environnement que le signataire, avec les mêmes défauts** —
`SIGNER_ISSUER_DID`, `SIGNER_KEY_NAME`, `SIGNER_KEY_PATH` — parce que les deux
doivent nommer la clé de la même manière : le signataire inscrit
`${ISSUER_DID}#${KEY_NAME}` dans chaque preuve, et `verify.js` exige
l'identifiant **exact**, sans correspondance approximative.

## Faire tourner la clé

Le document DID est **append-only** : retirer une clé rend invérifiable toute
attestation qu'elle a signée. `build.mjs` conserve donc les entrées existantes,
et **refuse** de republier un autre matériel sous un identifiant déjà utilisé.

Une rotation se fait en ajoutant :

```bash
SIGNER_KEY_NAME=key-2 node natixar.pro/build.mjs
```

et en posant **la même valeur sur le signataire**, sans quoi il signerait sous
un nom que le document ne publie pas. L'ancienne entrée reste, et les
attestations déjà émises continuent de se vérifier.

## Déployer

Netlify déploie depuis GitHub. Une fois le projet configuré sur le répertoire
ci-dessus, la fusion sur `main` suffit — il n'y a plus de zip à déposer.
