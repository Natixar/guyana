# FusionAuth et le framework d'autorisation de l'issue #39

*Note d'architecture, 28 juillet 2026. Révision 2 — décision prise. Document local, non versionné. Alimente #39, #17, #2, #3, #18, #20.*

**Décision : FusionAuth est retenu pour la couche 0.** Le mode d'hébergement (auto-hébergé ou Cloud managé) et la méthode de versionnement de sa configuration restent ouverts, et sont traités en §6 et §7.

---

## 1. Recadrage : les deux ne s'opposent pas

La comparaison telle qu'elle se pose spontanément — « notre solution ou FusionAuth » — n'est pas la bonne, parce que **#39 n'a jamais proposé d'écrire un fournisseur d'identité.** Le tableau de #39 nomme quatre couches et attribue explicitement la couche 0 à un produit tiers :

| Couche | Où | Décide | FusionAuth |
|---|---|---|---|
| **0 — Authentification** | **FusionAuth** derrière Traefik | *qui* : login, session, MFA, mot de passe oublié, fédération | **oui, entièrement** |
| **1 — Autorisation grossière** | Traefik `ForwardAuth` → service authz | `resource.action` | **fournit la source** des rôles (§2), la décision reste au service |
| **2 — Autorisation fine** | RLS PostgreSQL / couche de dépôt | portée : organisation, site, région, contrat, objet | **non, et ne le prétend pas** |
| **3 — Affordance UI** | `/api/me`, en relais | quoi afficher | **fournit la source**, `/api/me` la relaye et la complète |

> **Principe directeur de #39, à conserver verbatim :** la couche 3 n'est pas de la sécurité ; la couche 1 est nécessaire mais jamais suffisante ; **la couche 2 est la vraie frontière.**

Le risque réel n'est pas technique, il est psychologique : un produit d'identité complet, avec une console d'administration soignée et des rôles partout, donne le sentiment que l'autorisation est traitée. Elle ne l'est pas. Une fuite inter-clients se produit dans un `WHERE organization_id = ?` oublié, pas dans un jeton.

---

## 2. Les deux API, le relais, et le cache

### 2.1 D'où viennent les rôles gros grain

FusionAuth fournit la source, il n'y a rien à recoder :

| API | Ce qu'elle donne | Qui l'appelle |
|---|---|---|
| `/oauth2/userinfo` | claims utilisateur — identité, e-mail, attributs de registration | le serveur, après le flux OIDC |
| **JWT Validate** | le JWT décodé, **avec la liste des rôles** | le serveur, à chaque validation de session |

### 2.2 Pourquoi `/api/me` subsiste malgré tout

Deux raisons, et deux seulement — la première est une contrainte de sécurité, la seconde une contrainte de périmètre :

1. **Le credential reste `http-only`.** Si le SPA ne peut pas lire le jeton, il ne peut pas appeler JWT Validate lui-même : l'appel se fait côté serveur et le résultat est relayé. `/api/me` n'est donc pas une réimplémentation, c'est **le relais qui préserve la propriété anti-XSS.**
2. **La portée n'est pas dans FusionAuth.** Les rôles disent « cet utilisateur est `carbon.editor` » ; ils ne disent pas « sur les sites 3 et 7 de l'organisation AGM ». `/api/me` est le point où les rôles de FusionAuth et la portée calculée par l'application se rejoignent — et c'est le seul endroit où cette fusion a lieu.

### 2.3 Le cache — nécessaire, et dangereux pour une raison précise

Appeler FusionAuth à chaque requête est inacceptable en charge. Deux caches, deux durées de vie :

| Cache | Clé → valeur | Emplacement | TTL |
|---|---|---|---|
| **Identité** | `sessionId → {userId, orgId, rôles}` | relais `/api/me` | court |
| **Décision** | `(userId, resource.action, version) → allow/deny` | service authz (couche 1) | court |

**Le point qu'il faut écrire dans le code, pas seulement s'en souvenir :**

> Un cache réintroduit exactement la péremption silencieuse pour laquelle #39 a rejeté la liste de chemins signée dans le JWT. La différence est de degré, pas de nature.

Un cache n'est donc acceptable qu'accompagné d'un chemin d'invalidation **actif**. Deux mécanismes, complémentaires :

- **Un compteur de version des permissions**, incrémenté à tout changement de rôle ou de registration, et intégré à la clé de cache. Invalidation globale, grossière, instantanée, et pratiquement gratuite. C'est déjà ce que #39 prévoyait.
- **Les webhooks FusionAuth** (`user.update`, `user.deactivate`, `user.registration.update`) pour une invalidation ciblée. Cela rattache #20 (clés d'API et webhooks) au chemin critique de l'autorisation, alors qu'il était classé mineur.

Et la règle qui donne le bon TTL :

> **Le TTL maximal est le délai maximal que l'on accepte entre la révocation d'un accès et sa prise d'effet.** C'est une décision métier, pas un réglage de performance.

Recommandation : 60 secondes, plus l'invalidation par webhook. Le compteur de version couvre le cas où le webhook est perdu.

### 2.4 Correction : il n'y a qu'une seule application

Sur ce point je m'étais trompé dans la révision 1, où j'évoquais un portail listant plusieurs Applications FusionAuth via les registrations. Ce n'est pas le bon modèle, et il ne fonctionnerait pas : **l'utilisateur doit se connecter avant qu'on puisse afficher quoi que ce soit**, donc il n'y a rien à lister avant l'authentification.

Le modèle correct :

- **une seule Application au sens de FusionAuth**, avec des rôles à l'intérieur ;
- la page d'accueil affiche des **boutons d'accès** vers les ensembles de pages auxquels l'utilisateur a droit, et n'apparaît que s'il y en a plus d'un ;
- ces ensembles de pages ne sont **pas** des Applications FusionAuth : ce sont des **bundles front versionnés indépendamment** (CI **B2.x** du plan de déploiement, contrat **A6**).

Conséquence pratique : le JWT est délivré pour l'unique Application, il porte tous les rôles pertinents, et la coquille de portail n'a besoin de rien d'autre que de `/api/me` pour décider quels boutons rendre. C'est plus simple que ce que j'avais décrit, et c'est un découpage plus propre : un bundle se livre sans toucher à la configuration d'identité.

---

## 3. Ce que FusionAuth ne doit pas faire ici

FusionAuth sait exprimer des rôles illimités par application, et des **entités** avec des permissions à granularité fine ; l'éditeur a par ailleurs racheté **Permify**, service d'autorisation de type Zanzibar (ReBAC). Il est donc techniquement possible d'y loger une partie de la couche 1, voire de viser la couche 2.

**Ne pas le faire, pour trois raisons.**

1. **La portée par objet est indécidable hors de la base.** Pour `GET /api/batches/123`, la légitimité dépend de qui possède le lot 123. Ni le proxy ni le fournisseur d'identité ne le savent sans aller chercher la donnée.
2. **Les permissions détenues hors du code périment en silence.** C'est le défaut que #39 a rejeté sous une autre forme ; le reproduire dans une base tierce ne l'améliore pas.
3. **Le vocabulaire de permissions appartient à la spécification.** §2.1 définit `Permission { resource, action, scope }` avec `batch.read`, `shipment.confirm`, `carbon.edit`… Ce vocabulaire est le CI **A2** du plan de déploiement, et le critère d'acceptation de #39 exige que *la carte route → permission soit générée depuis le contrat d'API, et qu'une route non déclarée casse le build*. **Une carte qui vit dans une console d'administration ne peut pas casser un build.**

**Frontière retenue :**

```
FusionAuth   →  qui vous êtes · organisation · rôles gros grain · MFA · sessions · thème
Service authz →  resource.action, généré depuis le contrat d'API (A1/A2), versionné avec le code
PostgreSQL RLS →  portée organisation, site, contrat, objet — la base refuse, pas le code
/api/me       →  relais + fusion rôles/portée, affichage uniquement
```

Le service authz reste **petit** : il traduit `(méthode, route)` en `resource.action` et interroge les rôles mis en cache. Quelques centaines de lignes. L'effort n'est pas là — il est en couche 2, et aucun produit du marché ne l'écrit à notre place, parce qu'elle est spécifique au modèle de données.

---

## 4. Pourquoi les alternatives n'ont pas été retenues

| | **FusionAuth** *(retenu)* | Keycloak | Zitadel | oauth2-proxy + Authelia | Écrire soi-même |
|---|---|---|---|---|---|
| Multi-tenant natif (D1) | **oui** | realms, lourds | oui, orienté SaaS B2B | **non** | à écrire |
| Thèmes (#18) | **oui** | oui | partiel | non | à écrire |
| Exploitation | 1 app Java + PostgreSQL | JVM + Infinispan, tuning réel | binaire Go, la plus légère | très légère | — |
| Configuration en tant que code | **kickstart déjà écrit ici** | export de realm | API-first | YAML | — |
| Licence | source disponible, **non certifiée OSI** | Apache 2.0 | Apache 2.0 | Apache 2.0 / MIT | — |
| Offre managée par l'éditeur | **oui** | via tiers | oui | non | — |
| Raison du rejet | — | charge d'exploitation sans bénéfice ici | mérite équivalent, mais tout serait à intégrer | **sous-dimensionné pour D1** | **à proscrire** |

**Écrire son propre fournisseur d'identité est hors de question**, et il faut l'écrire noir sur blanc parce que la tentation revient toujours : mots de passe, MFA, réinitialisation, verrouillage, énumération de comptes, rotation de jetons, révocation de sessions, journalisation d'authentification opposable (§19). C'est un produit entier, avec une surface d'attaque que personne ne veut auditer, et rien de tout cela n'est différenciant pour Natixar.

Le seul concurrent de mérite comparable était **Zitadel** — même positionnement SaaS B2B multi-tenant, licence Apache 2.0 franche, exploitation plus légère. Ce qui a fait pencher la balance n'est pas une supériorité fonctionnelle : c'est que **la moitié du travail d'intégration est déjà faite ici** (§6) et que la comparaison avait déjà été instruite en 2023. **Zitadel reste le repli documenté** si l'une des vérifications de §5 tourne mal.

---

## 5. Les points à vérifier

Le dossier local date de 2023–2024 (`fusionauth.io_license.pdf` de novembre 2023, `fusionauth-vs-cognito.pdf` de la même période) et le découpage des éditions a changé depuis.

| # | À vérifier | Enjeu | Criticité |
|---|---|---|---|
| 1 | **MFA de base.** L'hypothèse de travail est que le code à usage unique **par courrier électronique** est inclus dans les éditions de base, le « MFA avancé » étant en édition Starter. À confirmer, mais ce n'est vraisemblablement pas bloquant | satisfait §19 au sens minimal | moyenne |
| 2 | **Entities et Client Credentials Grant sont en édition payante.** Le *client credentials grant* est ce qu'il faut pour l'authentification **machine-à-machine** — ingestion capteurs §4.7, API partenaires | peut forcer une édition payante pour une raison sans rapport avec les utilisateurs | **bloquante** |
| 3 | **Connectors** (SSO entrant / fédération) en édition Starter | conditionne #17 ; différable après septembre | faible |
| 4 | **Licence Community** : source disponible, non certifiée OSI, clauses d'usage commercial. Natixar exploite un SaaS commercial — il faut lire la clause, pas la résumer | juridique | **à faire relire** |
| 5 | **Webhooks** disponibles en Community | conditionne l'invalidation de cache de §2.3 | **bloquante** |
| 6 | Grille tarifaire 2026 (ordres de grandeur relevés chez des agrégateurs tiers : Starter ≈ 125 $/mois, Essentials ≈ 850 $/mois, Enterprise ≈ 3 300 $/mois pour les 10 000 premiers utilisateurs), et tarif de l'offre Cloud managée | budget, et modèle économique du POC (D8) | moyenne |

Une note honnête sur le point 1 : un code à usage unique envoyé par courrier électronique est le plancher du MFA. Si la boîte aux lettres est compromise, le second facteur l'est aussi. Pour une plateforme dont l'argument commercial est l'auditabilité, **TOTP est ce qu'un auditeur s'attend à trouver**. Cela ne bloque pas le POC ; cela doit figurer comme dette assumée plutôt que découverte en audit.

---

## 6. Ce que le dossier local apporte, ce qu'il faut corriger, et comment versionner

### 6.1 Acquis, réutilisable

- `kickstart/kickstart.json` — clé asymétrique RS256 nommée « For Natixar SaaS », configuration CORS, application, tenant, utilisateurs. Reproductible, versionnable, diffable.
- `kickstart/css/styles.css` et `login.html` — thème déjà travaillé, qui sert #18.
- `docker-compose.yml` fonctionnel.

### 6.2 À corriger avant tout usage au-delà du poste de développement

1. **Secrets de démonstration en clair** dans `kickstart.json` — `"apiKey": "this_really_should_be_a_long_random…"`, `adminPassword: password`, UUID figés — et mots de passe PostgreSQL en clair dans `.env`. À paramétrer via l'adaptateur de secrets du dossier de déploiement. **Aucun de ces fichiers ne doit être versionné en l'état.**
2. **Supprimer Elasticsearch.** Le compose démarre un Elasticsearch 7.17 en nœud unique avec `memlock` illimité, uniquement pour la recherche d'utilisateurs. `SEARCH_TYPE=database` suffit sur les volumes du POC : un composant en moins, plusieurs Go de RAM récupérés, une surface d'attaque supprimée.
3. **`ports: 9011:9011` et `9012:9012` exposés sur l'hôte** — contraire à D3. La console d'administration en particulier ne doit pas être joignable publiquement.
4. **`image: fusionauth/fusionauth-app:latest`** — à épingler par digest. On ne peut pas attester un tag mobile, donc le palier 5 de #44 est inatteignable tant que celui-ci reste.
5. URLs `http://localhost:3000` — à paramétrer par environnement.

### 6.3 Comment versionner la configuration d'identité (CI **B5**)

Trois mécanismes existent, et un seul répond réellement à la question :

| Mécanisme | Ce qu'il fait | Versionnable ? |
|---|---|---|
| **Kickstart JSON** | s'applique **uniquement sur une instance vierge** ; il ne reconfigure pas une instance déjà initialisée | **pour l'amorçage seulement** |
| **Export / sauvegarde puis restauration** | instantané complet de l'état | **non** — blob non diffable, couplé à la version de FusionAuth, et il ramène les données utilisateurs avec la configuration |
| **Réconciliation par l'API cliente** | script idempotent appliquant un état désiré déclaratif | **oui — c'est la réponse** |

*(Un provider Terraform communautaire existe ; sa maturité et son maintien restent à vérifier avant d'en dépendre.)*

**Recommandation — les deux, chacun à sa place :**

- **Kickstart en CI et en développement.** C'est précisément ce qui rend le job `ephemeral` possible : une instance FusionAuth vierge, configurée à l'identique en quelques secondes dans le runner, à chaque pull request.
- **Réconciliation par l'API dans les environnements réels.** Un fichier d'état désiré versionné, et un script idempotent qui applique la différence. C'est le step `52-identity-config.sh` du plan.

Le périmètre à versionner est petit, ce qui rend l'exercice raisonnable : le ou les tenants, l'unique Application, la **liste des rôles**, la politique MFA, le thème, les URL de redirection et CORS par environnement, et les **références** de clés — jamais le matériel cryptographique. Son contrat d'interface est **A2**, le vocabulaire de permissions : la configuration d'identité référence les rôles **par nom**, jamais par identifiant, ce qui lui permet d'évoluer sans coordination avec les politiques RLS.

La sauvegarde reste utile — mais comme sauvegarde, pas comme source de vérité. La distinction est celle-ci : *l'état désiré est dans le dépôt ; la sauvegarde sert à récupérer les données utilisateurs, pas la configuration.* Un environnement doit pouvoir être reconstruit depuis le dépôt seul, sans restauration.

---

## 7. Auto-hébergé ou Cloud managé — la décision restante

| | Auto-hébergé | Cloud managé |
|---|---|---|
| `deploy/steps/50-identity.sh` | à écrire et maintenir | **disparaît** |
| Sauvegardes, mises à jour, disponibilité | à notre charge | à la charge de l'éditeur |
| Configuration | kickstart + réconciliation | **réconciliation seule** (pas de kickstart sur instance existante) |
| Annuaire utilisateurs | chez nous | **chez l'éditeur** |
| Chemin d'authentification | interne | dépendance externe : si l'offre est indisponible, personne ne se connecte |
| Effort d'ici septembre | non nul | **quasi nul** |

**Décision : auto-hébergé d'abord**, parce que les `docker-compose` sont prêts et que c'est la voie la plus rapide — **sous la condition expresse que la configuration puisse être transférée sans douleur vers une instance Cloud.**

Cette condition n'est pas décorative, et elle a une conséquence qu'il faut voir tout de suite :

> **Le kickstart ne s'applique que sur une instance vierge.** Une instance FusionAuth Cloud est provisionnée déjà initialisée. Le kickstart ne pourra donc **jamais** servir à la migration. Le seul chemin est le script de réconciliation par l'API cliente de §6.3.

Autrement dit, la condition posée transforme le script de réconciliation d'optimisation confortable en **prérequis de la décision elle-même**. S'il n'est pas écrit, l'auto-hébergement n'est pas réversible et la condition n'est pas tenue. Il passe donc dans le lot 2 du dossier de déploiement, au même rang que le déploiement lui-même — et non « plus tard, quand on aura le temps ».

Deux précisions pour que la portabilité soit réelle :

1. **Configuration et données utilisateurs migrent séparément.** La réconciliation transporte tenants, application, rôles, politique MFA, thème, URL et références de clés. Elle ne transporte pas les comptes ni les empreintes de mots de passe : c'est un import distinct, ou une réinscription. Au stade POC, l'annuaire est petit et le sujet est mineur — mais il ne faut pas croire que le script fait les deux.
2. **Les clés de signature sont un point de rupture.** Si les jetons sont signés par une clé RS256 générée localement (c'est le cas du `kickstart.json` actuel, clé « For Natixar SaaS »), l'instance Cloud aura une autre clé et invalidera les sessions en cours. À prévoir comme une bascule, pas comme une continuité.

**Le test de la condition, à exécuter avant de s'engager :** monter une seconde instance auto-hébergée vierge, y appliquer le script de réconciliation seul — sans kickstart — et vérifier qu'elle est identique à la première. Une demi-journée, et c'est la preuve que la migration Cloud fonctionnera. À défaut de cette preuve, la condition n'est pas remplie.

Ce qu'il faudra consigner le jour de la bascule Cloud, plutôt que le découvrir :

- **L'annuaire utilisateurs part chez l'éditeur.** Au regard de #44 c'est acceptable — les identités ne sont pas le palier commercialement sensible, les prix, les contreparties et les volumes le sont, et ils ne quittent pas notre base. Mais il faut le dire au client.
- **La disponibilité de l'authentification devient une dépendance externe**, à couvrir contractuellement.

---

## 8. Actions

| # | Action | Issue |
|---|---|---|
| 1 | Instruire les vérifications 2, 4 et 5 (client credentials, licence, webhooks) — une demi-journée | #39 |
| 2 | Porter la décision « FusionAuth pour la couche 0, Cloud managé pour le POC » dans #39, #2, #3 | #39, #2, #3 |
| 3 | Porter la frontière du §3 dans #39 comme décision d'architecture, avec le principe directeur verbatim | #39 |
| 4 | Reclasser #20 (clés d'API et webhooks) : l'invalidation de cache le place sur le chemin critique de l'autorisation | #20 |
| 5 | Commenter #39 : décision ouverte n°2 tranchée par D1 (instance SaaS unique multi-clients) | #39, #18 |
| 6 | Trancher REST vs GraphQL (décision ouverte n°3 de #39) — préalable au `40-proxy.sh` | #39 |
| 7 | Reprendre le `kickstart.json` : paramétrage des secrets, épinglage par digest, retrait d'Elasticsearch, fermeture des ports | plan de déploiement, lot 2 |
| 8 | Rattacher #17 (SSO) à la vérification n°3 et l'ordonnancer après septembre | #17 |

---

*Sources :* [FusionAuth — Plans and Features](https://fusionauth.io/docs/get-started/core-concepts/plans-features) · [FusionAuth — tarifs](https://fusionauth.io/pricing) · [FusionAuth — autorisation à granularité fine](https://fusionauth.io/docs/extend/fine-grained-authorization) · [FusionAuth — Permify et l'autorisation fine](https://fusionauth.io/blog/grand-line-of-fine-grained-authorization) · [CIAM Compass — profil FusionAuth (licence Community, non certifiée OSI)](https://guptadeepak.com/ciam-compass/vendors/fusionauth/) · [Cerbos — Keycloak vs Zitadel](https://www.cerbos.dev/blog/keycloak-vs-zitadel) · [Skycloak — comparaison des solutions d'authentification open source 2026](https://skycloak.io/blog/open-source-authentication-comparison-2026/)
