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

La source de ce site est **`natixar.pro/` dans ce dépôt**, et le répertoire que
Netlify publie est **`natixar.pro/public`**. Le projet Netlify
(`heroic-dango-aec695`) clone le dépôt et sert ce répertoire tel quel : **aucune
commande de construction**. Détail dans [`natixar.pro/README.md`](../natixar.pro/README.md).

Deux conséquences de cette absence de construction chez Netlify :

- **le document DID engendré est versionné.** Un fichier produit par une étape
  que Netlify n'exécute pas doit exister dans le dépôt, sans quoi il n'existe
  nulle part ;
- **le script et son test restent hors de `public/`.** Le lien profond
  fonctionne : tout fichier placé dans le répertoire publié est servi à qui en
  devine le chemin.

### Le document DID de `did:web:natixar.pro`

L'émetteur déclaré de toute la chaîne de signature est `did:web:natixar.pro`
(`services/store/app.py`, `services/signer/server.mjs`), ce qui se résout en
`https://natixar.pro/.well-known/did.json`. Un vérificateur y lit la clé
publique qui lui permet de contrôler une attestation **sans rien nous
demander** : c'est l'énoncé que tout le projet existe pour tenir.

Le document est **engendré**, jamais rédigé, par `natixar.pro/build.mjs`, qui
lit la clé du signataire dans `deploy/secrets/local/signer_key.jwk` (hors dépôt)
et n'en publie que la partie publique. Il satisfait quatre exigences :

| | |
|---|---|
| type | `application/json` — Netlify le déduit de l'extension, et `_headers` le confirme |
| origine | `Access-Control-Allow-Origin: *` — un vérificateur en navigateur lit ce document depuis une AUTRE origine, et sans cet en-tête la requête échoue chez lui, sur une page que nous ne voyons pas |
| accès | aucune authentification : c'est une clé publique |
| fragment | **`#key-1`**, et c'est le piège ci-dessous |

> **Le piège du fragment.** Le signataire inscrit dans chaque preuve
> `${ISSUER_DID}#${KEY_NAME}`, soit `did:web:natixar.pro#key-1`. Or
> `site/assets/js/did.js` construit ses documents avec un fragment qui est
> **l'empreinte RFC 7638 de la clé**, jamais un nom — correction délibérée, pour
> que deux clés distinctes cessent de recevoir le même identifiant. Les deux
> conventions sont défendables ; elles ne sont pas compatibles, et `verify.js`
> exige l'identifiant **exact**, sans correspondance approximative. Un document
> engendré par `buildDidDocument()` pour la clé de Natixar ne correspondrait à
> **aucune preuve émise**, et la vérification échouerait en « clé absente du
> document » — un diagnostic exact et parfaitement déroutant.
>
> C'est pourquoi `build.mjs` lit **les mêmes variables d'environnement que le
> signataire, avec les mêmes défauts**. Les changer d'un côté sans l'autre reste
> possible ; cela ne peut plus se faire par inadvertance de rédaction.

**Le document est append-only.** Retirer une clé rend invérifiable toute
attestation qu'elle a signée. `build.mjs` conserve donc les entrées existantes
et **refuse** de republier un autre matériel sous un identifiant déjà utilisé —
une rotation se fait en ajoutant, sous `SIGNER_KEY_NAME=key-2`, la même valeur
devant être posée sur le signataire.

`natixar.pro/build.test.mjs` éprouve tout cela en signant une attestation avec
une paire jetable, puis en la vérifiant contre le document produit. Deux de ses
cas relisent en outre le fichier **versionné** : la CI ne peut pas le
régénérer — la clé du signataire n'y est pas — et rien n'empêcherait sinon qu'il
soit édité à la main.

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
