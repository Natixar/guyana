# Natixar Gold Trace — Aurora

Preuve de concept, horizon H1 (FIDES). Propriété de Natixar — voir
[`NOTICE`](NOTICE).

Une barre de doré quitte une mine avec deux affirmations : d'où elle vient, et
ce qu'elle a coûté en carbone. Ce dépôt produit de quoi **signer** ces
affirmations, et surtout de quoi permettre à un acheteur, un affineur ou un
auditeur de les **vérifier sans nous faire confiance**.

C'est cette dernière phrase qui commande toute l'architecture. La page de
vérification est publique et recalcule tout dans le navigateur ; la clé publique
de l'émetteur est publiée sur son propre domaine ; la clé de signature et les
données ne se rencontrent jamais dans un même processus.

## Deux publications, deux systèmes

C'est le point le plus mal compris du montage, et il tient en un tableau.

| Domaine | Contenu | Publié par | Où |
|---|---|---|---|
| `guyana.natixar.pro` | l'application — [`site/`](site/), [`services/`](services/) | [`deploy/`](deploy/), par ssh | kubb, derrière Traefik |
| `natixar.pro` | la redirection et le document DID — [`web/natixar.pro/`](web/natixar.pro/) | Netlify, depuis GitHub | — |

**Netlify n'exécute aucune construction** et ne publie que `web/natixar.pro`.
Le site Hugo ne part pas chez lui : sa commande de construction est un no-op
explicite, et sa règle `ignore` annule la publication tant que cette charge
utile n'a pas bougé. Tout est déclaré dans [`netlify.toml`](netlify.toml).

## Organisation

| | |
|---|---|
| [`site/`](site/) | l'application, construite par Hugo. Le moteur de calcul et de signature est en modules ES, exécutés **aussi** côté serveur — un moteur, deux hôtes |
| [`services/`](services/) | le back-office : `signer` détient la clé et aucune base, `store` détient la base et aucune clé |
| [`deploy/`](deploy/) | des instructions de déploiement **exécutables**, et `verify/` qui affirme les invariants |
| [`web/natixar.pro/`](web/natixar.pro/) | la charge utile statique du domaine principal |
| [`tools/`](tools/) | outils hors ligne, dont le générateur du document DID |
| [`documentation/`](documentation/) | comment l'ensemble tient debout |
| `poc-data/` | les données du client — **hors gestion de version**, voir plus bas |

## Faire tourner les contrôles

Aucun ne demande kubb ; tous tournent en intégration continue.

```bash
node services/run-vectors.mjs             # un moteur, deux hôtes : mêmes vecteurs
node services/run-jcs-vectors.mjs         # sérialisation canonique, hôte JavaScript
node --test tools/make-did.test.mjs       # le document DID de l'émetteur
python3 site/check-labels.py              # aucun libellé d'interface muet

(cd services/signer && npm ci --omit=optional && node --test "*.test.mjs")

# Le magasin, puis l'interopérabilité — dans cet ordre : le second consomme
# l'échantillon signé que le premier produit, et qui n'est pas versionné.
(cd services/store && python3 -m pytest -q)      # exige un vrai PostgreSQL
node services/verify-store-signature.mjs         # Python signe, JavaScript vérifie
```

Les tests du magasin s'exécutent contre un **vrai** PostgreSQL : l'essentiel de
ce qu'ils vérifient est du comportement de la base, et un bouchon confirmerait
nos hypothèses au lieu de les éprouver.

Les deux dernières lignes sont **les deux moitiés d'un seul contrôle**. Python
signe, JavaScript vérifie — et l'échec serait muet : une signature DER là où
WebCrypto attend `r||s` ne lève pas, elle renvoie `false`, ce qui ressemble à
une clé fausse. Deux implémentations qui se croient d'accord ne valent rien tant
qu'aucune n'a vérifié la signature de l'autre.

## Déployer, et vérifier

```bash
./deploy/deploy.sh --env kubb              # simulation (défaut)
./deploy/deploy.sh --env kubb --apply      # exécution réelle
bats deploy/verify/*.bats                  # après coup — c'est la moitié du travail
```

`--apply` refuse de s'exécuter sur un arbre de travail modifié : ce qui est
déployé doit être ce qui est commité.

`deploy/verify/` est séparé de `deploy/steps/` parce que ce sont des
**spécifications**, pas des tests d'implémentation : « le conteneur ne publie
aucun port » reste vrai si l'on passe de Docker à Podman. Les invariants sont
énoncés dans [`deploy/README.md`](deploy/README.md).

## Le document DID de l'émetteur

`did:web:natixar.pro` se résout en `https://natixar.pro/.well-known/did.json`.
C'est là qu'un vérificateur lit la clé publique qui lui permet de contrôler une
attestation sans rien nous demander.

Le fichier n'est **pas** écrit à la main et n'est **pas** un gabarit. Il est
produit par [`tools/make-did.mjs`](tools/make-did.mjs) à partir de la clé de
l'émetteur, qui arrive par `stdin` et ne touche jamais le disque :

```bash
deploy/secrets/fetch.sh signer_key \
  | node tools/make-did.mjs --from-private - --also-key-name key-1
```

Le nom logique est `signer_key`, avec un **souligné** : c'est celui que
`deploy/secrets/fetch.sh` reconnaît.

Trois règles, chacune ayant son garde dans l'outil ou dans
`deploy/verify/verify-did.bats` :

- **jamais de clé d'exemple.** Tant que la clé de l'émetteur n'existe pas, le
  fichier reste absent et l'adresse répond 404. Un document DID résoluble
  annonçant une clé que personne ne détient est pire qu'une absence : il a
  toutes les apparences d'un émetteur en état de marche, et fait échouer la
  vérification au lieu de la signaler indisponible ;
- **on ajoute, on ne retire jamais.** Le document est *append-only* : supprimer
  une entrée de `verificationMethod` rend invérifiable toute attestation que
  cette clé a signée ;
- **le fichier se régénère, il ne s'édite pas.** `--verify-file` refuse un
  fragment qui a la forme d'une empreinte sans en être une — exactement ce que
  produit une retouche à la main.

## Ce qui n'est pas dans ce dépôt, et volontairement

**Les données du client.** Le paquet physique vit sous `poc-data/`, il est
confidentiel au titre de la clause 9 de l'accord de collaboration, et il est
exclu de la gestion de version. Rien ici ne peut en recopier le contenu dans un
fichier suivi. La taxonomie pivot, elle, est publiée :
`site/static/engine/taxonomy.json`.

**Les secrets.** Ils transitent par `stdout` et ne sont jamais persistés, ni sur
le poste de contrôle ni sur la cible. `deploy/secrets/fetch.sh` est l'unique
adaptateur vers leur source ; voir [`deploy/secrets/README.md`](deploy/secrets/README.md).

**Les documents de travail.** `analyses/` porte des notes, des courriers et des
éléments qui ne quittent pas le poste : le répertoire est ignoré.

## Pour comprendre le montage

[`documentation/`](documentation/) explique comment l'ensemble tient debout —
la chaîne Hugo → image → conteneur → Traefik → domaine, le routage et ses
priorités, le serveur statique et son conteneur. Le code reste la source de
vérité ; ces notes l'expliquent.

Les écarts et les décisions ouvertes ne sont pas consignés là : ils vivent dans
les issues.
