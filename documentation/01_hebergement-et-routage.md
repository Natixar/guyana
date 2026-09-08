# 01 — Hébergement et routage du site statique

*État constaté le 8 septembre 2026. Embryon : cette note décrit la chaîne
réellement déployée, pas une cible.*

---

## En une phrase

Le site est un ensemble de fichiers statiques construits par Hugo sur le poste
de contrôle, scellés dans une image Docker, lancés sur kubb dans un conteneur
sans port publié, et publiés par un Traefik **qui ne nous appartient pas** —
auquel nous parlons uniquement par des étiquettes posées sur nos propres
conteneurs.

---

## La chaîne, de bout en bout

```
   POSTE DE CONTRÔLE (le portable de JM)              CIBLE (kubb)
   ─────────────────────────────────────              ────────────────────────

   site/  ── hugo ──▶  site/public/
                          │
                          │  tar sur stdin, par ssh
                          │  (rien ne s'écrit sur la cible)
                          ▼
                     docker build ────────────────▶  image  aurora-site
                                                        │
                                                        │  docker run, réseau `proxy`
                                                        ▼
                                                   conteneur  guyana-site
                                                   ├─ /static-web-server
                                                   ├─ --root=/public
                                                   └─ étiquettes traefik.*
                                                        │
                                                        │  découverte docker
                                                        ▼
                                                     TRAEFIK  (autre projet)
                                                        │  TLS, ACME « porkbun »
                                                        ▼
                                              https://guyana.natixar.pro/
```

Trois choses méritent d'être soulignées dans ce dessin.

**Le contenu vit dans l'image.** Jamais en montage lié depuis l'hôte. Une image
a un digest : elle s'atteste et se déploie par digest. Un répertoire déposé sur
l'hôte, non — il dérive en silence, et plus rien ne dit ce qui est servi.
C'est l'invariant 3 de [`deploy/README.md`](../deploy/README.md).

**Rien ne s'écrit sur la cible.** Le contexte de construction et les scripts
d'étape voyagent par `stdin`. Un fichier laissé sur kubb survivrait au
conteneur et à notre attention.

**Nous sommes locataires du proxy.** kubb nous appartient, son Traefik non : il
est installé et configuré par un script dédié, et toute édition manuelle de sa
configuration serait écrasée à sa prochaine exécution. Nous n'écrivons donc ni
dans `traefik.yml`, ni dans `/home/traefik/routing`. Tout notre routage passe
par des étiquettes sur nos conteneurs — ce qui a une conséquence pratique
constante : **changer une règle de routage impose de recréer le conteneur**, les
étiquettes Docker n'étant pas modifiables à chaud.

---

## Qui sert quel domaine — et ce que la question cache

C'est le point le plus mal compris du montage, et il vaut un tableau.

| Domaine | Résolution (8 sept. 2026) | Servi par | Nous ? |
|---|---|---|---|
| `guyana.natixar.pro` | `90.53.125.57` = `proxy.critical-optimisation.com` | Traefik sur kubb → `guyana-site` | **oui** |
| `natixar.pro` | `75.2.60.5`, `99.83.231.61` | **Netlify** | non |
| `www.natixar.pro` | CNAME `heroic-dango-aec695.netlify.app` | **Netlify** | non |

**Le domaine principal ne passe pas par nous.** Notre Traefik ne voit jamais une
requête pour `natixar.pro`. Aucune étiquette, aucune configuration de notre
serveur statique ne peut changer ce qu'il répond.

Ce n'est pas un obstacle, parce que ce site est un **pur déploiement de
fichiers** dont nous tenons la source :

- `/` et `/index.html` rendent un HTML de 388 octets qui redirige vers
  `www.natixar.com` — le domaine n'est qu'une redirection, il n'y a pas de site
  derrière ;
- **le lien profond fonctionne** : n'importe quel fichier déposé est servi à son
  chemin, `.well-known/` compris ;
- un chemin absent rend un **404 franc**, et non un repli déguisé en succès —
  ce qui est le comportement que notre propre serveur statique n'a pas
  (voir [02](02_static-web-server.md)).

La source de ce site est **`web/natixar.pro/` dans ce dépôt**, et c'est aussi
le répertoire que Netlify publie — déclaré dans [`netlify.toml`](../netlify.toml)
à la racine. Le projet Netlify s'appelle `natixar-pro` (anciennement
`heroic-dango-aec695`) ; il clone le dépôt et sert ce répertoire tel quel.

Trois réglages de `netlify.toml` méritent d'être lus.

**`command = "true"`** — un no-op explicite. L'absence de commande laisserait la
détection de framework de Netlify décider seule, et elle décide mal sur un dépôt
qui contient un site Hugo qu'elle ne doit surtout pas construire.

**`publish = "web/natixar.pro"`** — le site Hugo n'est PAS publié ici. Il va sur
kubb, sous `guyana.natixar.pro`, par `deploy/`. Les deux domaines sont servis par
deux systèmes différents à partir du même dépôt, et c'est cette ligne qui les
sépare.

**`ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- web/natixar.pro netlify.toml"`**
— soixante tickets touchent `services/`, `deploy/` et `site/` ; les laisser
publier `natixar.pro` serait du bruit et un risque. `git diff --quiet` sort 0
quand rien n'a changé, et Netlify annule la construction sur un code 0. Au
premier build `$CACHED_COMMIT_REF` est vide, la commande échoue, le code est non
nul : on construit. **L'échec est du bon côté.**

Netlify n'exécutant aucune construction, **le document DID engendré est
versionné** : un fichier produit par une étape que personne ne joue doit exister
dans le dépôt, sans quoi il n'existe nulle part.

### Le document DID de `did:web:natixar.pro`

L'émetteur déclaré de toute la chaîne de signature est `did:web:natixar.pro`
(`services/store/app.py`, `services/signer/server.mjs`), ce qui se résout en
`https://natixar.pro/.well-known/did.json`. Un vérificateur y lit la clé
publique qui lui permet de contrôler une attestation **sans rien nous
demander** : c'est l'énoncé que tout le projet existe pour tenir.

Le document est **engendré**, jamais rédigé, par
[`tools/make-did.mjs`](../tools/make-did.mjs). La clé privée lui arrive par
`stdin` et ne touche jamais le disque — règle de `deploy/secrets/README.md` :

```bash
deploy/secrets/fetch.sh signer_key \
  | node tools/make-did.mjs --from-private - --also-key-name key-1
```

`web/natixar.pro/_headers` complète le service : `application/did+json`,
`Access-Control-Allow-Origin: *` et `max-age=0, must-revalidate`. **CORS n'est
pas décoratif** — `did-source.js` résout le DID depuis le navigateur, donc
depuis `guyana.natixar.pro`, une autre origine. Sans cet en-tête la lecture
échoue en silence et le vérificateur se rabat sur l'exemplaire embarqué : il
croirait vérifier en ligne sans le faire.

#### Deux fragments pour une seule clé

Le document publie la même clé publique sous **deux identifiants**, et cette
redondance est un choix, pas un accident.

| Fragment | Pourquoi |
|---|---|
| `#<empreinte RFC 7638>` | l'identifiant de référence. `site/assets/js/did.js` publie ainsi, et l'argumente : sous un nom logique, deux clés distinctes reçoivent le même identifiant et la fusion supprime l'ancienne à tous les coups — exactement la perte qu'elle existait pour empêcher. |
| `#key-1` | ce que `services/signer/server.mjs` inscrit réellement dans ses preuves, par `${ISSUER_DID}#${KEY_NAME}`. |

Les deux conventions ne peuvent pas coexister dans un seul identifiant : une
attestation du signeur serveur est orpheline dans un document construit par
`did.js`, et `verify.js` exige l'identifiant **exact**, sans correspondance
approximative — le cas est déjà testé par `selftest.js` sous `missingKey`.
Publier les deux entrées ne ferme aucune porte et débloque la publication ; la
convergence du signeur vers l'empreinte est une décision distincte, ouverte.

Vérifié avec la clé réellement déployée : une attestation signée sous **chacun**
des deux fragments se vérifie contre le document publié.

#### Ce que les contrôles attrapent

`tools/make-did.mjs --verify-file` établit la cohérence **interne** du document,
sans aucun secret — c'est donc le seul contrôle exécutable en intégration
continue. Il refuse un fragment qui a la *forme* d'une empreinte sans en être
une, un `controller` qui ne désigne pas le document, un membre `d` — une clé
privée publiée est brûlée —, un `assertionMethod` sans méthode correspondante,
et un document où aucune clé n'est adressable par son empreinte.

Ce qu'il n'attrape pas : un document parfaitement cohérent bâti sur une clé que
personne ne détient. Seul `--check`, avec la clé privée, le dit — et il ne peut
donc pas tourner en CI.

`deploy/verify/verify-did.bats` prend le relais sur le document **en ligne** :
publication, type, CORS, émetteur, absence de clé privée, et présence de
l'identifiant sous lequel le signeur signe.

---

## Le routage Traefik, en entier

Tout est déclaré dans [`deploy/steps/60-app.sh`](../deploy/steps/60-app.sh) et
[`deploy/steps/50-services.sh`](../deploy/steps/50-services.sh). Trois
conteneurs se partagent un même nom d'hôte, et c'est la **priorité** qui tranche.

| Priorité | Routeur | Règle | Vers | Authentifié |
|---:|---|---|---|---|
| 3000 | `guyana-pour` | `Path(/api/v1/pour)` | site | oui |
| 2500 | `guyana-public` | `/verify`, `/css/`, `/js/`, `/fonts/`, `/img/`, `/favicon.svg`, `Path(/engine/taxonomy.json)` | site | **non** |
| 2000 | `guyana-signer` | `PathPrefix(/api/v1/sign)` | signataire | oui |
| 1000 | `guyana-store` | `PathPrefix(/api/v1)` | magasin | oui |
| 10 | `guyana-r1` | `Host(guyana.natixar.pro)` | site | oui |
| 1 | `guyana-any` | `HostRegexp(^guyana\..+$)` | site | oui |

### Pourquoi les priorités sont explicites, et si grandes

Faute de priorité déclarée, **Traefik la calcule sur la longueur de la règle**.
Le routeur du site porte ``Host(`guyana.natixar.pro`)`` — une trentaine de
caractères, donc une priorité d'une trentaine. Des valeurs de 10 et 20 posées
sur l'API se faisaient battre par un routeur qui ne mentionnait même pas
`/api/v1`. Le magasin n'a jamais été joignable depuis le navigateur, et personne
ne l'a vu : **le site répond 200 avec sa page d'accueil pour tout chemin
inconnu**, si bien qu'une erreur de routage prenait l'apparence d'un succès.

Ce mode de panne — un 200 qui masque une absence — revient trois fois dans
l'histoire de ce déploiement, et une quatrième sur les fichiers cachés :
mesures dans [02](02_static-web-server.md).

### Les exceptions nommées

`/api/v1/pour` et `/api/v1/sign` sont des chemins que le préfixe `/api/v1`
emporterait vers le magasin, qui ne les sert pas. Plutôt qu'affaiblir la règle
du magasin, on **nomme l'exception** avec une priorité supérieure, et
`verify-http.bats` l'affirme.

### La page publique

`/verify/` est ouverte sans mot de passe, et c'est une décision de fond : cette
page existe pour démontrer qu'un acheteur ou un auditeur peut contrôler une
attestation **sans nous faire confiance**. On ne prouve pas qu'on est superflu
derrière une porte dont on tient la clé.

Une page publique, c'est **la page et tout ce qu'elle charge**. Le 3 août 2026,
la page était ouverte mais pas son logo ni ses polices : un navigateur qui
reçoit `401` avec `WWW-Authenticate: Basic` sur une `<img>` ou une `@font-face`
**ouvre la fenêtre d'identification** — pour la ressource, pas pour la page. Le
vérificateur se voyait donc réclamer un mot de passe sur une page répondant 200.
`verify-public.bats` suit désormais les sous-ressources, `url()` des feuilles de
style comprises.

`/engine/` reste **fermé**, délibérément : il porte l'exemplaire embarqué du
document DID, et la page publique ne doit pas pouvoir s'y rabattre en silence —
ce serait une démonstration truquée. Seul `/engine/taxonomy.json` est ouvert, par
chemin **exact** et non par préfixe, parce qu'un préfixe emporterait
`/engine/did/` avec lui.

---

## Les intergiciels

Trois, déclarés sur nos conteneurs, appliqués par les routeurs ci-dessus.

| Nom | Effet |
|---|---|
| `guyana-auth` | `basicauth`, avec `headerfield=X-Webauth-User` |
| `guyana-sec` | `frameDeny`, `contentTypeNosniff`, `referrerPolicy=strict-origin-when-cross-origin` |
| `guyana-fresh` | `Cache-Control: no-cache` sur tout ce que le site sert |

**`headerfield` est le mécanisme d'identité.** Le middleware ne se contente pas
de filtrer : il **pose** `X-Webauth-User` sur la requête, et c'est de là que
`/api/v1/me` tire l'identité qu'il rend. Corollaire contre-intuitif, appris le
3 août 2026 : ouvrir `/api/v1/me` sans ce middleware ne rend pas la route
permissive, il la rend **aveugle** — plus d'en-tête, donc « non authentifié »
pour tout le monde, y compris pour un opérateur dûment connecté.

**Chaque conteneur déclare ses propres intergiciels.** Les routeurs de l'API
référençaient ceux du site ; or le lanceur recrée le site *après* les services,
et pendant ce laps Traefik voyait des routeurs pointant vers un intergiciel
absent. L'API répondait 404 à chaque redéploiement jusqu'au retour du site.
Quelques étiquettes de plus suppriment une dépendance d'ordre entre étapes.

**`guyana-fresh` a une raison précise.** Hugo nomme chaque module par
l'empreinte de son contenu ; le serveur statique met ces URL en cache un an, ce
qui est correct. Mais le HTML est le seul document dont l'URL ne change jamais :
un navigateur qui l'a chargé hier le ressert aujourd'hui, avec les empreintes
d'hier, et charge donc les modules d'hier depuis son cache d'un an. Le 2 août
2026, la page d'auto-test a exécuté un moteur de la veille contre des vecteurs
du jour ; vingt et un cas sont tombés. Le serveur servait le bon code — le
navigateur ne l'a jamais demandé.

`no-cache` ne veut pas dire « ne garde rien » mais « revalide avant de servir » :
avec l'ETag, une ressource inchangée coûte un 304 et zéro octet.

> **Un seul émetteur par en-tête.** Le serveur statique sait poser ses propres
> `Cache-Control`. Deux autorités pour un même en-tête est un état où la
> question « qui gagne ? » a une réponse que personne n'a décidée — elle dépend
> de l'ordre d'écriture, donc d'une version de Traefik. Le conteneur est donc
> lancé avec `--cache-control-headers=false` : Traefik est seul émetteur, et le
> comportement se lit en un seul endroit.

---

## Le certificat

Chaque routeur TLS porte `tls.certresolver=porkbun`, dont le nom vient du
descripteur d'environnement et n'a **aucune valeur par défaut**. C'est
délibéré : `tls=true` sans résolveur ne demande aucun certificat — Traefik sert
le sien, interne, et le navigateur ouvre une alerte de sécurité sur un service
parfaitement sain. Tous les invariants qui lisent un code HTTP passent. C'est le
mode de panne du 3 août 2026, et `verify-tls.bats` le nomme désormais
explicitement (« pas le repli interne de Traefik »), plutôt que de le laisser se
manifester comme un échec de poignée de main.

Un nom de résolveur inventé n'échouerait pas au déploiement mais au
renouvellement, quatre-vingt-dix jours plus tard, sur une machine que personne
ne regarde ce jour-là. D'où l'invariant « le certificat n'expire pas dans les
14 jours ».

---

## Les autres conteneurs

Pour situer le site dans l'ensemble — le détail appartient à une note à écrire.

| Conteneur | Réseaux | Détient |
|---|---|---|
| `guyana-site` | `proxy` | rien |
| `guyana-signer` | `proxy` | la clé de signature, **aucune base** |
| `guyana-store` | `proxy` + `guyana-data` | la base, **aucune clé d'attestation** |
| `guyana-db` | `guyana-data` (interne) | l'état, dans un volume nommé |

L'invariant fondateur — *la clé de signature et les données ne se rencontrent
jamais* — est ici une **topologie**, pas une intention : le signataire n'est pas
sur le réseau de la base, et `50-services.sh` le constate après coup plutôt que
de le supposer.

---

## Comment on déploie, et comment on vérifie

```bash
./deploy/deploy.sh --env kubb              # simulation (défaut)
./deploy/deploy.sh --env kubb --apply      # exécution réelle
bats deploy/verify/*.bats                  # après coup — c'est la moitié du travail
```

`--apply` refuse de s'exécuter sur un arbre de travail modifié : ce qui est
déployé doit être ce qui est commité.

`deploy/verify/` est séparé de `deploy/steps/` parce que ce sont des
**spécifications**, pas des tests d'implémentation : « le conteneur ne publie
aucun port » reste vrai si l'on passe de Docker à Podman. C'est ce qui permet
aux mêmes fichiers de tourner dans trois contextes — le job d'intégration
continue, un cron nocturne, et `deploy.sh` après chaque déploiement.

La vérification qui compte le plus est `verify-neighbours.bats` : sur une
infrastructure partagée, le risque n'est pas que notre déploiement échoue, il
est qu'il casse autre chose. (Voir l'anomalie signalée plus haut : cette liste
contient aujourd'hui un domaine qui n'est pas sur la machine.)

---
