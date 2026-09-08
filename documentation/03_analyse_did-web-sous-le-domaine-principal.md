# 03 — Publier `did:web:natixar.pro` : note d'analyse

*8 septembre 2026. Issue #96. Toutes les mesures citées ont été faites ce
jour-là sur l'image réelle ; kubb était éteinte et n'a pas été sollicitée.*

---

## La question posée, et celle qu'il faut poser

**Question posée.** Le serveur statique déployé pour le site peut-il servir le
document DID de Natixar sous le domaine principal, sans casser les autres règles
de routage ? Et faut-il plutôt un second conteneur dédié, bâti sur la même image
de base ?

**Ce que l'examen a trouvé.** La question technique est réelle et la réponse
suit plus bas, mais elle est précédée d'une question qui n'est pas technique :

> **`natixar.pro` n'est pas servi par nous.** L'apex est hébergé chez Netlify.
> Notre Traefik ne voit jamais une requête pour ce domaine. Aucun réglage de
> notre serveur statique — aucun — ne peut faire répondre cette URL tant que
> l'enregistrement DNS pointe ailleurs.

Constaté ce jour :

```
natixar.pro         A      75.2.60.5, 99.83.231.61
                    →      HTTP 200, en-tête « server: Netlify »
                    →      /.well-known/did.json  :  404, servi par Netlify

www.natixar.pro     CNAME  heroic-dango-aec695.netlify.app

guyana.natixar.pro  A      90.53.125.57 = proxy.critical-optimisation.com  (kubb)
```

La suite de cette note traite donc deux choses distinctes, et il faut les tenir
séparées : **où le document doit vivre** (§ 2 à 4), et **comment notre serveur
le servirait** si on le lui demandait (§ 5 et 6).

---

## 1. Ce qu'il faut publier, exactement

`did:web` n'a pas de registre : la résolution est une simple lecture HTTPS.
`did:web:natixar.pro` se résout en `https://natixar.pro/.well-known/did.json`,
et la force du montage tient entièrement là — le vérificateur va chercher la clé
**chez l'émetteur**, sans avoir à nous croire.

Le document doit satisfaire cinq contraintes. Les trois premières viennent de la
spécification, les deux dernières de notre propre code.

1. **Servi en `application/json`.** Un `text/html` fait échouer la résolution.
2. **Servi en HTTPS, avec un certificat valide.**
3. **Lisible depuis une autre origine.** Un vérificateur qui exécute son outil
   dans un navigateur fera une requête *cross-origin* : sans
   `Access-Control-Allow-Origin`, elle échoue. Le document est public par
   nature ; `*` est la valeur juste.
4. **Sans authentification.** Une porte fermée devant la clé publique de
   l'émetteur vide le montage de son sens.
5. **Le fragment doit être `#key-1`.** C'est le piège de ce dossier, et il
   mérite d'être posé noir sur blanc.

### Le piège du fragment

Le signataire inscrit dans chaque preuve l'identifiant
`${ISSUER_DID}#${KEY_NAME}`, soit — valeurs par défaut de
`services/signer/server.mjs` — **`did:web:natixar.pro#key-1`**.

Or `site/assets/js/did.js` construit ses documents avec un fragment qui est
**l'empreinte RFC 7638 de la clé**, jamais un nom. C'est une correction
délibérée et bien argumentée dans ce fichier : deux clés distinctes recevaient
sinon le même identifiant `key-1`, et la fusion supprimait l'ancienne à tous les
coups.

Les deux conventions sont chacune défendable. Elles ne sont pas compatibles.
Un document engendré par `buildDidDocument()` pour la clé de Natixar porterait
`did:web:natixar.pro#<empreinte>` et **ne correspondrait à aucune preuve
émise** : la vérification échouerait en « clé absente du document », ce qui est
un diagnostic exact et parfaitement déroutant.

Le document à publier doit donc porter, au minimum :

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
  "id": "did:web:natixar.pro",
  "verificationMethod": [{
    "id": "did:web:natixar.pro#key-1",
    "type": "JsonWebKey",
    "controller": "did:web:natixar.pro",
    "publicKeyJwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
  }],
  "assertionMethod": ["did:web:natixar.pro#key-1"]
}
```

La partie publique existe déjà : `deploy/secrets/fetch.sh` engendre la paire
P-256 et écrit le JWK public à côté du privé. **Aucun code du dépôt ne produit
aujourd'hui ce document.** C'est un manque à combler quelle que soit l'option
retenue.

> **Rappel qui contraint toutes les options.** Le document DID est
> *append-only* : retirer une clé rend invérifiable toute attestation qu'elle a
> signée. Le mécanisme de publication doit rendre l'ajout facile et le retrait
> difficile. Un fichier scellé dans une image, versionné et déployé par digest,
> satisfait cela mieux qu'un fichier déposé à la main dans une interface web.

---

## 2. Le défaut à corriger, indépendamment de tout le reste

Avant même de choisir où publier : **sur un domaine que nous servons
aujourd'hui, le montage actuel ne servirait pas ce document, et mentirait en le
faisant.**

Mesuré sur `ghcr.io/static-web-server/static-web-server:2` (2.44.0) avec les
drapeaux exacts de `deploy/steps/60-app.sh` :

```
GET /.well-known/did.json   ->  200   content-type: text/html    corps = index.html
GET /engine/taxonomy.json   ->  200   content-type: application/json
```

Deux causes qui se composent :

1. **SWS refuse les fichiers cachés par défaut** — dotfiles *et* répertoires en
   point. `.well-known/` est donc un 404 interne.
2. **`--page-fallback` transforme ce 404 en 200** portant la page d'accueil.

C'est la quatrième occurrence, dans l'histoire de ce déploiement, du même mode
de panne : *une absence qui prend l'apparence d'un succès*. Les trois
précédentes sont consignées dans `50-services.sh` (routage de l'API),
`60-app.sh` (la coulée d'exemple) et `verify-tls.bats` (le certificat par
défaut).

Le correctif tient en un drapeau — `--ignore-hidden-files=false` — et la mesure
le confirme :

```
GET /.well-known/did.json   ->  200   content-type: application/json   (le bon corps)
```

Mais ce drapeau **n'a pas de granularité** : il rouvre tous les dotfiles de la
racine, pas seulement `.well-known/`. Sur une racine engendrée par Hugo, c'est à
regarder avant d'appuyer.

> **Recommandation, valable quelle que soit la suite.** Ajouter à
> `deploy/verify/` un invariant qui échoue si `/.well-known/did.json` répond
> autre chose que du JSON — 404 franc compris. Aujourd'hui cette URL ment, et
> rien dans le dispositif de vérification ne peut s'en apercevoir : ni les
> `bats`, qui lisent des codes HTTP, ni le journal d'accès de Traefik, filtré
> sur les 4xx/5xx et qui ne voit donc que des 200, ni le journal de SWS, muet au
> niveau `error`. **Une ressource absente ne laisse aujourd'hui aucune trace
> nulle part.**

---

## 3. Où le document peut vivre : les quatre voies

| | Voie | Qui agit | Le document reste-t-il sous SCM ? |
|---|---|---|---|
| **V1** | fichier déposé sur le site Netlify de Natixar | Natixar | non |
| **V2** | l'apex est repointé vers kubb | Natixar (DNS) | oui |
| **V3** | Netlify **relaie** `/.well-known/did.json` vers un sous-domaine que nous servons | Natixar (une ligne) + nous | oui |
| **V4** | l'émetteur devient un domaine que nous servons déjà | nous seuls | oui |

### V1 — Natixar dépose le fichier chez Netlify

Le plus court. Une personne ajoute `.well-known/did.json` à la racine du site
vitrine, et l'URL répond. Netlify sert le JSON avec le bon type et un
certificat valide ; il faudra vérifier l'en-tête CORS et l'ajouter par un
fichier `_headers` si besoin.

*Ce qu'on perd.* Le document sort de notre gestion de configuration : pas de
digest, pas d'attestation, pas de revue. Chaque rotation de clé devient une
demande à un tiers, et la propriété *append-only* ne repose plus que sur la
vigilance de la personne qui édite. C'est précisément le genre de fichier dont
une suppression accidentelle invalide rétroactivement toutes les attestations
émises.

### V2 — repointer l'apex vers kubb

**À écarter.** L'apex sert le site vitrine de Natixar. Le repointer le casserait,
et kubb — une machine qu'on a trouvée éteinte aujourd'hui — deviendrait le point
de défaillance unique de la présence web de l'entreprise. Le rapport bénéfice /
risque est absurde pour un fichier de 400 octets.

### V3 — Netlify relaie vers un sous-domaine que nous servons

Netlify sait réécrire une URL vers une cible externe en conservant le code 200
(règle de type *proxy*, dans `_redirects` ou `netlify.toml`) :

```
/.well-known/did.json   https://did.natixar.pro/.well-known/did.json   200
```

L'apex répond alors avec **notre** document, servi par **notre** conteneur, sans
que rien d'autre du site vitrine ne bouge. On garde le digest, la revue, le
déploiement par image ; Natixar ajoute une ligne, une fois.

*Réserves à lever avant de s'y engager.* Le relais externe dépend du plan
Netlify souscrit et de ses limites ; l'en-tête CORS et le type de contenu
doivent survivre au relais ; et un relais ajoute un maillon qui peut tomber sans
prévenir. **À confirmer avec Natixar avant d'être proposé comme la solution.**

### V4 — changer l'émetteur

`SIGNER_ISSUER_DID` et `STORE_ISSUER_DID` sont des variables d'environnement,
avec `did:web:natixar.pro` pour seul défaut. Les basculer sur
`did:web:guyana.natixar.pro` — un domaine que nous servons déjà — rend la
résolution possible **sans dépendre de personne**.

*Ce qu'on perd, et c'est sérieux.* Le DID change, donc l'identité de l'émetteur
change : toute attestation déjà émise sous `did:web:natixar.pro` devient
orpheline. C'est plus grave qu'un retrait de clé — c'est un changement de
sujet, et aucun chaînage `previousVersionDigest` ne le rattrape. Et
sémantiquement, l'identité d'une entreprise a sa place sur son domaine
principal, pas sur le sous-domaine d'un projet.

*Quand c'est néanmoins le bon choix.* Si l'échéance de la démonstration arrive
avant la décision de Natixar. Le montage devient alors vrai de bout en bout —
une résolution réseau réelle, ce qui est plus démontrable que le dépôt manuel
d'aujourd'hui — au prix d'un identifiant qu'il faudra migrer plus tard, pendant
que le corpus d'attestations est encore petit.

---

## 4. Ce qui n'est pas de notre ressort

Les voies V1, V2 et V3 exigent toutes une action de Natixar : éditer le site
vitrine, ou changer un enregistrement DNS, ou ajouter une règle de relais.
**Aucune quantité d'ingénierie de notre côté ne s'y substitue.** C'est un point
à porter à Natixar comme une décision, pas comme une tâche.

La V4 est la seule entièrement de notre ressort.

---

## 5. Option A — le conteneur existant sert aussi le document

*Hypothèse de travail pour cette section et la suivante : la V2 ou la V3 a
abouti, et un nom de domaine destiné au document arrive jusqu'à notre Traefik.*

### A1 — même racine pour les deux domaines

Ajouter le domaine à `APP_DOMAINS`. Un routeur de plus, aucune autre
modification.

**À écarter.** Le domaine servirait alors **l'application Guyana entière** —
`/register/`, `/bar/`, `/api/v1/...` — derrière une fenêtre de mot de passe. Sur
le domaine principal d'un client, c'est inacceptable. Et il faudrait quand même
un routeur public séparé pour le seul `.well-known`, donc la complexité de
l'option A2 en plus du défaut.

### A2 — hôtes virtuels de SWS

SWS sait servir une racine différente selon l'en-tête `Host`, par fichier TOML.
Testé ce jour, et cela fonctionne :

```toml
[general]
root = "/public"
page-fallback = "/public/index.html"
ignore-hidden-files = false

[advanced]
[[advanced.virtual-hosts]]
host = "natixar.pro"
root = "/apex"
```

Résultat mesuré :

```
Host: guyana.natixar.pro   /.well-known/did.json  ->  200  application/json   (racine du site)
Host: natixar.pro          /.well-known/did.json  ->  200  application/json   (racine apex)  ✔
Host: natixar.pro          /engine/taxonomy.json  ->  200  text/html          ✗
```

**La troisième ligne est le défaut de l'option.** `page-fallback` est une option
**globale** : elle s'applique à l'hôte virtuel, mais sert le `index.html` de la
racine **principale**. Conséquence : `natixar.pro/n-importe-quoi` renverrait la
page d'accueil de l'application Guyana, en 200. Sur le domaine vitrine d'un
client, c'est une fuite doublée d'un mensonge.

SWS n'offre pas de repli par hôte virtuel. Le contourner supposerait de
renoncer à `--page-fallback`, dont dépend le routage côté client de
l'application. **Il n'y a pas de réglage qui satisfasse les deux.**

### Ce que l'option A coûte par ailleurs

- **La configuration quitte `60-app.sh`.** Elle passe dans un fichier TOML qu'il
  faut copier dans l'image, versionner et tenir à jour. Le montage perd sa
  propriété la plus commode : se lire en entier au même endroit.
- **`ignore-hidden-files=false` s'applique à toute la racine du site**, pas au
  seul apex.
- **Un routeur Traefik supplémentaire est nécessaire de toute façon**, sans
  authentification et avec l'en-tête CORS, pour le seul chemin
  `/.well-known/did.json`.
- **Les deux contenus deviennent solidaires.** Une rotation de clé impose de
  reconstruire et redéployer **tout le site** ; réciproquement, chaque
  déploiement du site met en jeu la disponibilité du document DID. Un seul
  conteneur, un seul rayon d'explosion.

---

## 6. Option B — un second conteneur dédié, même image de base

Un conteneur `guyana-did`, bâti sur `ghcr.io/static-web-server/static-web-server:2`,
dont la racine ne contient que le document.

```dockerfile
FROM ghcr.io/static-web-server/static-web-server:2
COPY did/ /public/
```

```bash
docker run -d --name guyana-did --network proxy \
  --restart unless-stopped --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  <étiquettes traefik, préfixées guyana-> \
  guyana-did:<digest> \
  --root=/public --port=80 --ignore-hidden-files=false --cache-control-headers=false
```

**Pas de `--page-fallback`.** C'est le point décisif, et il est mesuré :

```
sans page-fallback, avec ignore-hidden-files=false :
  /.well-known/did.json  ->  200  application/json
  /n-importe-quoi        ->  404                      ✔ un 404 franc
```

Le routeur Traefik correspondant, dans l'esprit de ceux qui existent :

| | |
|---|---|
| règle | ``Host(`…`) && Path(`/.well-known/did.json`)`` — chemin **exact**, jamais un préfixe |
| priorité | explicite et haute, comme `guyana-pour` (3000) |
| intergiciels | `guyana-sec` **sans** `guyana-auth` : le document est public par nature |
| en-tête | `Access-Control-Allow-Origin: *`, à poser par un intergiciel Traefik dédié |
| TLS | `certresolver=porkbun`, comme partout ailleurs — jamais `tls=true` seul |

### Confrontation aux invariants de `deploy/README.md`

| | Invariant | Option A | Option B |
|---|---|---|---|
| 1 | ne pas toucher à la configuration de Traefik | ✔ étiquettes | ✔ étiquettes |
| 2 | aucun port publié | ✔ | ✔ |
| 3 | le contenu vit dans l'image | ✔ | ✔ |
| 4 | rien ne s'écrit sur la cible | ✔ | ✔ |
| 5 | aucun secret persisté | ✔ (le document ne contient qu'une clé **publique**) | ✔ |
| 6 | nos routeurs sont préfixés `guyana-` | ✔ | ✔ **à condition** de nommer le routeur `guyana-did` et non `natixar-did` |
| 7 | ne pas revendiquer un sous-domaine réservé | ✔ | ✔ (`did.*` n'est pas réservé) |
| 8 | les voisins ne cassent pas | ✔ | ✔ |

**Aucune des deux options ne casse un invariant.** Le choix ne se joue donc pas
là, mais sur le comportement observable et sur le couplage.

### Le test d'indépendance

*Peut-on livrer A sans un commit dans B ?* Le document DID change à la rotation
d'une clé — un événement rare, sensible, qui mérite sa propre revue. Le site
change à chaque évolution fonctionnelle — plusieurs fois par semaine. Deux
cadences, deux niveaux de risque, deux relecteurs. Ce sont **deux éléments de
configuration**, et les tenir dans une seule image les confond.

Argument supplémentaire, propre à ce document : un fichier *append-only* dont
chaque version est un digest d'image est bien plus facile à auditer quand
l'image ne contient que lui. « Voici les trois digests successifs du document
DID » est une phrase qui a un sens ; elle n'en a plus si chaque digest emporte
aussi deux cents fichiers du site.

### Le coût réel

Un `steps/70-did.sh` d'une quarantaine de lignes, un `verify/verify-did.bats`
d'une dizaine, une image de 8,4 Mo, et une entrée dans le descripteur
d'environnement. Le conteneur ne porte aucun état, ne joint aucun réseau de
données, et ne détient rien de secret.

---

## 7. Recommandation

**Trois actions, dans cet ordre. La première ne dépend de personne.**

**1. Corriger le mensonge, tout de suite.** Un invariant dans `deploy/verify/`
qui échoue si `/.well-known/did.json` répond autre chose que du JSON. Aujourd'hui
cette URL rend `200 text/html` et rien ne peut s'en apercevoir. Ce correctif
vaut quelle que soit l'option retenue ensuite, et il est entièrement de notre
ressort. *À ouvrir comme issue distincte.*

**2. Retenir l'option B — un second conteneur dédié.** Elle évite le seul
défaut technique dirimant de l'option A (le repli de page qui fait fuir
l'application sur le domaine vitrine), elle sépare deux éléments de
configuration dont les cadences n'ont rien à voir, et elle coûte une
cinquantaine de lignes. L'option A ne devient préférable que si l'on refuse
absolument un conteneur de plus — ce que rien n'impose ici.

**3. Porter la question du domaine à Natixar**, en présentant V1 et V3 comme
deux décisions et non comme deux tâches. La V3 (relais Netlify vers
`did.natixar.pro`) est la meilleure des deux : l'apex répond, le document reste
sous notre gestion de configuration, et Natixar n'ajoute qu'une ligne. Elle
demande d'abord une vérification des capacités de relais du plan Netlify.

**Repli si la décision tarde au-delà de l'échéance de démonstration :** la V4 —
basculer l'émetteur sur un domaine que nous servons — avec l'engagement écrit de
migrer vers l'apex, pendant que le corpus d'attestations est encore petit. Le
coût de la migration croît avec chaque attestation émise.

---

## 8. Ce qui reste ouvert

1. **Aucun code ne produit le document DID de Natixar.** Le JWK public existe ;
   le document, non. À écrire, avec le fragment `#key-1` — voir le piège du § 1.
2. **Les deux conventions de fragment divergent** (`#key-1` côté signataire,
   `#<empreinte>` côté navigateur). Elles ne se rencontrent pas aujourd'hui.
   Elles se rencontreront le jour où l'on voudra faire tourner la clé de
   Natixar, et ce jour-là il sera tard.
3. **`natixar.pro` figure dans `NEIGHBOURS`** alors qu'il n'est pas sur kubb :
   la vérification de non-régression passe sans rien mesurer. À corriger ou à
   requalifier explicitement en « témoin externe ».
4. **La rotation de la clé de Natixar n'a pas de procédure**, quel que soit le
   support de publication.
