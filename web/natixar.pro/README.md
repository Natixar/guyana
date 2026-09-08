# web/natixar.pro

Charge utile statique publiée par Netlify sur **https://natixar.pro**.

Ce dossier n'est pas un site. Il porte deux choses, et rien d'autre :

| Chemin | Rôle |
|---|---|
| `index.html` | redirection des visiteurs humains vers natixar.com |
| `.well-known/did.json` | document DID de `did:web:natixar.pro`, clé publique de l'émetteur |
| `_headers` | type de contenu et CORS du document DID |

## Ce qui n'est pas ici

Le site Hugo (`../../site/`) est publié sur **guyana.natixar.pro** par
`deploy/`, sur kubb, derrière Traefik. Netlify n'en construit rien : sa
commande de construction est un no-op et son `ignore` (voir `netlify.toml` à la
racine) annule la publication tant que ce dossier n'a pas bougé.

## did.json

Le fichier n'est PAS écrit à la main et n'est PAS un gabarit. Il est produit
par `tools/make-did.mjs` à partir de la clé de l'émetteur :

    deploy/secrets/fetch.sh signer_key \
      | node tools/make-did.mjs --from-private - --also-key-name key-1

Le nom logique est `signer_key`, avec un SOULIGNÉ : c'est celui que
`deploy/secrets/fetch.sh` reconnaît, et `fetch.sh signer-key` sortirait sur son
message d'usage.

Tant que la clé de l'émetteur n'existe pas, le fichier est absent et
`https://natixar.pro/.well-known/did.json` répond 404. **Ne jamais y déposer une
clé d'exemple :** un document DID résoluble annonçant une clé que personne ne
détient est pire qu'une absence de document, parce qu'il a toutes les apparences
d'un émetteur en état de marche.
