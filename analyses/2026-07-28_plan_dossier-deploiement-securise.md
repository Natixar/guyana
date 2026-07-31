# Plan — Dossier d'instructions de déploiement (essentielles pour la sécurité)

*Note d'architecture, 28 juillet 2026. Document local, non versionné. Statut : premier plan, à valider avant ouverture d'issue.*

Issues concernées : #39 (framework d'autorisation), #44 (confidentialité vis-à-vis de l'opérateur), #43 (stockage séries temporelles), #40 (ancrage), #18 (modèle de déploiement). Action A7 du relevé du 28/07.

---

## 1. Principe directeur

> **Une instruction de déploiement qui n'est pas exécutable n'est pas une instruction de déploiement : c'est un vœu.**

Le dossier n'est pas de la documentation d'exploitation. C'est un ensemble d'éléments de configuration (CI) exécutables, testés, versionnés et rejouables sur un hôte neuf. Cette exigence n'est pas de la ferveur méthodologique : elle est la condition de trois choses que le projet a déjà promises par ailleurs.

| Promesse déjà faite | Ce qu'elle impose au déploiement |
|---|---|
| #44 — « aucun accès n'est possible par une seule personne » | l'élévation de privilège, le break-glass *k-parmi-n* et la journalisation d'accès sont des artefacts de déploiement, pas des consignes |
| #44 — attestation, build reproductible | l'artefact déployé doit être dérivable de la source revue |
| #40 — le journal d'accès administratif est ancré | le déploiement produit lui-même des événements ancrables |
| D3 (réunion 28/07) — passage obligatoire par un proxy | la topologie réseau est une propriété vérifiable, pas une intention |

Corollaire opérationnel : **tout ce qui est écrit dans ce dossier doit pouvoir échouer en CI.** Une règle qui ne peut pas casser un build est une règle décorative — c'est exactement le reproche fait dans #44 aux règles `code_scanning` / `code_quality` activées sans scanner configuré.

---

## 2. Ce que `bash-deploy-libs` apporte déjà

Le dépôt (lien local → `SI/PlexMediaServer`, branche `main`, ~100 KB de bibliothèques sous `config/`) n'est pas un projet Plex : c'est un socle de déploiement Bash durci, dont Plex n'est que le cas d'usage historique. Les trois bibliothèques répondent à trois problèmes de sécurité distincts du déploiement.

### 2.1 `command_guard.sh` — intégrité de la résolution des commandes

`cg_guard` définit une fonction Bash qui masque la commande externe et l'appelle **par chemin absolu**, de sorte qu'un préfixe `PATH` hostile n'a plus d'effet. `cg_safe_run` va plus loin : dans la fonction appelée, toute commande externe non gardée provoque un **abandon dur** (échec d'assignation `readonly`).

*Pertinence directe.* Un script de déploiement s'exécute en root sur le proxy et sur les hôtes de base de données. C'est la cible canonique d'une attaque par `PATH`, et c'est aussi le point où un `curl` ou un `docker` détourné donne l'exécution de code à distance sur toute la flotte. `cg_safe_run` transforme cette vulnérabilité silencieuse en panne visible.

*Bonus déjà écrit* : `scripts/detect_unguarded_calls.sh` (présent dans le skill SCM et dans `.claude/commands/` du dépôt bibliothèque) — c'est le gate CI, il existe.

### 2.2 `remote_run.sh` — pas d'empreinte sur l'hôte cible

`rr_run user@host deploy.sh` exécute un script local sur l'hôte distant **sans écrire un seul fichier sur le système de fichiers distant**. Le script et toutes ses dépendances `source` restent sur la machine de contrôle ; le distant les reçoit à la demande par un canal TCP privé monté en `ssh -R`.

C'est la propriété la plus intéressante du lot pour ce projet, pour trois raisons :

1. **Aucun résidu.** Pas de script de déploiement abandonné dans `/tmp` ou `/opt`, donc pas de secret ni de topologie laissés en clair sur un hôte compromis plus tard.
2. **Source de vérité unique.** Ce qui tourne sur l'hôte est exactement ce qui est dans le dépôt de la machine de contrôle, à l'instant de l'exécution. Il n'y a pas de version « déployée » qui puisse diverger.
3. **Contrainte de surface.** Le distant n'a besoin que de `sshd`, `bash ≥ 4.3` et `base64`. Aucun agent, aucun démon de configuration, aucun port entrant supplémentaire.

`rr_init -S state --ssh-opt … --allow …` capture les options une fois et permet le déploiement parallèle sur plusieurs hôtes — utile dès qu'il y a proxy + app + base séparés.

### 2.3 `handle_state.sh` — rollback discipliné

`hs_persist_state` transporte un état opaque (scalaires, tableaux indexés et associatifs, namerefs, format HS2 avec checksum) entre les fonctions d'initialisation et de nettoyage. Traduit en déploiement : **chaque étape qui crée quelque chose persiste ce qu'il faut pour le défaire.** Un déploiement interrompu à mi-parcours se rembobine au lieu de laisser un hôte dans un état indéterminé — état indéterminé qui est, en pratique, la première cause de configuration de sécurité involontairement permissive.

### 2.4 Le harnais, qui compte autant que les bibliothèques

`ci-bats.yml`, `.shellcheckrc`, 5 suites Bats (avec `bats-assert` / `bats-support` en sous-modules), documentation Sphinx par bibliothèque, `CODEOWNERS`, et le processus SCM lui-même. Le dossier de déploiement Guyana hérite de tout cela sans rien réécrire.

### 2.5 Ce qui manque, et qu'il faut écrire

| Manque | Constat | Effort |
|---|---|---|
| `ensure_docker.sh` | référencé dans `docs/_build/libraries/ensure_docker.html` (artefact périmé) mais **absent de `config/`** — à retrouver dans l'historique ou à réécrire | moyen |
| Script de déploiement applicatif | `test/test-install_plex_remote.bats` teste un `install_plex_remote` qui n'est pas dans le dépôt : les scripts *applicatifs* vivent hors du dépôt bibliothèque. C'est le bon découpage, mais il n'y a donc **aucun exemple de bout en bout à copier** | moyen |
| Gestion des secrets | aucune. Le `.env` de FusionAuth contient des mots de passe en clair, à côté d'un `kickstart.json` avec `"apiKey": "this_really_should_be_a_long_random…"`. C'est acceptable pour une maquette 2023, pas pour le POC | **élevé, bloquant** |
| TLS / ACME / Traefik | rien | moyen |
| Base de données : rôles, migrations, RLS | rien — et c'est là que se joue la couche 2 de #39 | **élevé** |
| Journal de déploiement ancrable | rien (dépend de #40) | faible, différable |

---

## 3. Découpage en configuration items et contrats d'interface

### 3.1 Le critère

> **Un commit sur A peut-il être fusionné et publié sans commit simultané sur B ?**

Si la réponse est non, A et B sont un seul configuration item, quel que soit le nombre de répertoires qui les séparent. Le séquencement du processus SCM — documentation, tests préliminaires, implémentation — sépare des artefacts **dans le temps**, pas **en configuration** : ce n'est donc pas une preuve d'indépendance.

Deux couplages se ressemblent et n'ont pas le même traitement :

| Couplage | Exemple | Verdict |
|---|---|---|
| **de construction** — les artefacts n'ont de sens qu'ensemble | code et ses tests unitaires ; `steps/40-proxy.sh` et ses tests de fonction | **même CI, définitivement** |
| **de contrat** — les artefacts se parlent par une interface | frontend/backend ; application/schéma ; application/déploiement | **démontable** |

La manœuvre est toujours la même :

> **On extrait le contrat en configuration item à part entière, et les deux côtés deviennent indépendants.**

Un artefact de contrat n'a aucune existence à l'exécution. Sa seule raison d'être est de rendre deux autres CI indépendants — et il ne le fait que s'il **casse un build** quand il est violé. Un contrat qui ne peut pas casser un build est de la documentation, et deux CI séparés par de la documentation ne sont pas indépendants : ils sont dans des répertoires différents.

### 3.2 Rang A — artefacts de contrat

| CI | Contenu | Consommateurs | Règle de version |
|---|---|---|---|
| **A1 — Contrat d'API** | OpenAPI + extension `x-permission` par opération | backend, fronts, service authz, job `contract` | semver ; ajout = mineur ; toute rupture = majeur, chaque côté déclare l'intervalle supporté |
| **A2 — Vocabulaire de permissions** | `resource.action` de §2.1 + types de portée | A1, politiques RLS, configuration d'identité | **additif seulement** dans un majeur ; retirer ou renommer = majeur |
| **A3 — Taxonomie d'événements + sérialisation canonique** | noms d'événements, champs, ordre canonique, emplacement du nonce | application, service d'ancrage, **vérificateurs tiers** | **versions immuables, append-only** |
| **A4 — Invariants de déploiement** (`deploy/verify/`) | assertions sur un système en marche | job `ephemeral`, cron, opérateur | lente ; retirer un invariant exige une justification écrite |
| **A5 — Manifeste de déploiement applicatif** | variables d'environnement, ports, volumes, endpoint de santé, secrets **par nom logique**, migrations exigées | `deploy/steps/` | additif = mineur ; un nouveau secret requis = majeur |
| **A6 — Manifeste des bundles front** | pour chaque ensemble de pages : identifiant, rôle(s) requis, point d'entrée, version | coquille de portail, page d'accueil | additif = mineur |

### 3.3 Rang B — implémentations

| CI | Notes |
|---|---|
| **B1 — Backend** (+ ses tests unitaires) | couplage de construction avec ses tests |
| **B2 — Coquille de portail** | session, routage, page d'accueil. Rend un bouton d'accès par bundle dont l'utilisateur détient le rôle requis |
| **B2.x — Bundles front** | *n* ensembles de pages, **versionnés indépendamment**. Ce ne sont pas des applications au sens FusionAuth : il n'y a qu'une seule application, avec des rôles. L'authentification précède l'affichage — la page d'accueil ne montre que ce à quoi l'utilisateur a droit, et n'apparaît qu'au-delà d'un bundle accessible |
| **B3 — `deploy/steps/`** (+ ses tests unitaires) | |
| **B4 — Pilote d'ancrage** | adaptateur de chaîne |
| **B5 — Configuration d'identité** | état déclaratif du fournisseur d'identité — dépend de A2 |

### 3.4 Rang C — données de référence versionnées

**C1** schéma et migrations · **C2** jeu de facteurs et méthodologie carbone (`factorSetVersion`, règles §14.2) · **C3** éditions de nomenclatures HS/CN/TARIC — trivialement indépendant, nous n'en contrôlons pas la cadence.

### 3.5 Rang D — externe

**D1** `bash-deploy-libs` : déjà indépendant et déjà prouvé tel — sous-module épinglé, contrat = les signatures et codes d'erreur documentés (`cg_guard`, `hs_*`, `rr_run`).

### 3.6 Les contrats, concrètement

**A1 ↔ B1 / B2.x.** Le job `contract` échoue si le backend expose une route absente du contrat, si une route du contrat n'a pas d'`x-permission`, ou si la carte route → permission commitée est périmée. C'est ce qui rend le backend et les fronts indépendants : un bundle génère son client depuis A1 et n'a jamais besoin de lire le code du backend.

**A2 ↔ A1, RLS, B5.** Permissions et rôles sont référencés **par nom, jamais par identifiant**. C'est ce qui permet à la configuration d'identité d'évoluer sans coordination avec les politiques RLS : les deux pointent vers le même vocabulaire versionné.

**A3 — le cas le plus dur.** `canonical(e)` doit être une fonction pure de `(schemaVersion, payload)` et ne jamais dépendre du code qui a produit l'événement. Le contrat est testable sous la forme de **vecteurs de référence** : un jeu figé de triplets `(événement, nonce, engagement attendu)` commité, qui doit continuer à passer indéfiniment. Le jour où un changement du backend casse un vecteur de 2026, la PR est rouge — c'est exactement le signal recherché.

Ce CI a une propriété qu'aucun autre ne partage : **certains de ses consommateurs nous sont inaccessibles à jamais.** Un auditeur qui vérifie en 2040 un passeport publié en 2026 est un consommateur qu'on ne peut pas mettre à jour. La contrainte vaut aussi pour C2 — un `CarbonEntry` référence son jeu de facteurs pour toujours. Ces CI ne sont pas « versionnés » au sens habituel : leurs versions sont **publiées et gelées**.

**A4 ↔ B3.** `deploy/verify/` n'est pas aux `steps/` ce que les tests unitaires sont au code. `verify-network.bats` affirme *« aucun port applicatif n'est joignable hors du proxy »* — un énoncé vrai indépendamment de la manière dont `30-network.sh` s'y prend, et qui doit rester vrai si l'on passe de Docker à Podman. C'est une **spécification**, pas un test d'implémentation. Les tests unitaires des fonctions de `steps/` restent, eux, dans B3. Le contrat de A4 est un descripteur d'environnement — URL de base, identifiants de test, deux tenants A et B — et **rien de la topologie**.

**A5 ↔ B3.** Sans manifeste, une variable d'environnement ajoutée au backend impose un commit simultané dans `deploy/` : les deux ne sont pas indépendants, ils en donnent l'apparence. Avec manifeste, `deploy/steps/` ne connaît plus l'application — il lit sa surface de configuration et la satisfait. Combiné au déploiement **par digest**, cela rend B3 indépendant de B1 et B2 pour de bon.

**A6 ↔ B2 / B2.x.** C'est ce qui permet de livrer un bundle sans redéployer le portail, et de faire apparaître un nouvel écran en publiant un bundle plus un rôle. La coquille ne connaît aucun bundle par son nom : elle lit le manifeste, filtre par rôle, et rend les boutons.

**C1 ↔ B1.** Migrations *expand/contract*, en avant seulement ; le schéma en version *S* doit servir l'application en version *S−1*. Vérifiable : le job `ephemeral` applique la migration *S* puis lance l'image applicative *S−1* contre elle.

**B4.** `anchor(root) → receipt{chain, txid, blockTime}` et `verify(root, receipt) → bool`. C'est ce qui fait du choix de chaîne un paramètre plutôt qu'une décision d'architecture.

### 3.7 Les découpages que je ne ferais pas

- **Frontend et backend sans A1 réellement appliqué.** Sans le job qui casse le build, ils ne sont pas indépendants : ils sont couplés par une convention orale, ce qui est pire que d'être dans le même CI, parce que la rupture se découvre en production au lieu d'en revue.
- **`steps/` et ses tests unitaires.** Couplage de construction.
- **Le service authz séparé du vocabulaire de permissions.** Le service *implémente* A2, il ne le définit pas. Deux CI qui ne bougeraient jamais l'un sans l'autre.

### 3.8 Application à l'existant

Le code existant est incomplet — le manquant est reconstituable — mais **la réflexion qui a présidé à son écriture n'est pas enregistrée** : pas d'issues, pas de traces de processus. La couverture de tests est vraisemblablement insuffisante.

Conséquence directe sur ce découpage : la première passe n'est pas une conception, c'est une **reconstruction**. On déclare A1, A2, A3, A5 et A6 *à partir de ce que le code fait déjà*, on les fige, puis on laisse les gates de CI les verrouiller. Déclarer le contrat après coup est désagréable mais faisable ; le déduire à nouveau dans six mois ne le sera plus.

Deux règles pratiques pour ne pas se bloquer :

- **Couverture en cliquet, pas en seuil.** Un seuil absolu sur du code hérité est soit inatteignable, soit fixé si bas qu'il ne prouve rien. La règle utile est : la couverture ne diminue pas, et tout code touché par une PR est couvert.
- **Ce qui n'a pas de contrat déclaré est réputé instable.** Tant que A1 n'existe pas, aucun bundle front ne peut être annoncé comme indépendamment déployable — ce serait une indépendance de façade.

---

## 4. Structure proposée du dossier

```
deploy/
├── README.md                      # les invariants, en tête ; le reste est exécutable
├── deploy.sh                      # lanceur semi-automatique : main → commit → digest → env → rr_run
├── lib/                           # sous-module → bash-deploy-libs
│   └── config/{command_guard,handle_state,remote_run}.sh
├── inventory/
│   ├── hosts.d/<env>.env          # topologie, sans aucun secret
│   └── topology.md                # schéma réseau : ce qui est vérifié par 60-verify
├── secrets/
│   ├── README.md                  # d'où viennent les secrets — jamais les secrets
│   └── fetch.sh                   # adaptateur unique vers le coffre retenu
├── steps/
│   ├── 00-preflight.sh            # OS, versions, horloge, empreintes SSH, espace
│   ├── 10-hardening.sh            # sshd, pare-feu, sysctl, comptes, sudo, auditd
│   ├── 20-runtime.sh              # docker/podman + ensure_docker (à écrire)
│   ├── 30-network.sh              # réseaux, isolation, aucune exposition directe (D3)
│   ├── 40-proxy.sh                # Traefik : TLS, ACME, ForwardAuth (#39 couche 1)
│   ├── 50-identity.sh             # fournisseur d'identité (#39 couche 0 — cf. fiche FusionAuth)
│   ├── 55-database.sh             # PostgreSQL : rôles, RLS, migrations (#39 couche 2)
│   ├── 58-timeseries.sh           # partitionnement natif ou TimescaleDB (#43)
│   ├── 60-app.sh                  # services applicatifs
│   ├── 70-observability.sh        # journaux, métriques, journal d'accès inviolable (#44)
│   └── 80-backup.sh               # sauvegardes chiffrées, restauration **testée**
├── verify/                        # exécutable après déploiement, et en CI nocturne
│   ├── verify-network.bats        # aucun port applicatif joignable hors proxy
│   ├── verify-tls.bats
│   ├── verify-authz.bats          # une requête sans session est refusée par le proxy
│   ├── verify-rls.bats            # un rôle applicatif ne voit pas les données d'un autre tenant
│   └── verify-secrets.bats        # aucun secret sur disque distant, aucun dans l'image
├── breakglass/                    # #44 : élévation temporaire, k-parmi-n, journalisée
└── runbooks/                      # les rares choses vraiment manuelles, avec justification
```

Deux règles de structure valent d'être énoncées :

- **`verify/` n'est pas la fin de `steps/`.** Il tourne séparément, sur un environnement déployé, y compris planifié. Une vérification qui ne s'exécute qu'à la suite du déploiement ne détecte pas la dérive.
- **`runbooks/` doit rester embarrassant.** Toute procédure manuelle porte la raison pour laquelle elle n'est pas automatisée. C'est le meilleur mécanisme connu pour que le dossier ne redevienne pas de la prose.

---

## 5. Intégration continue, frontière des secrets, et déclenchement du déploiement

### 5.1 Le modèle retenu

**GitHub ne déploie pas.** Une application GitHub serait trop lourde à écrire, tester et déployer pour le POC — et le raisonnement de sécurité va dans le même sens : une application GitHub suppose un récepteur de webhooks hébergé, une clé de signature et un échange de jetons. C'est un service en production avec un point d'entrée entrant, c'est-à-dire exactement la surface d'accès permanent que #44 cherche à supprimer.

Le partage est donc :

| | Rôle |
|---|---|
| **GitHub** | supervision et gestion : issues, revue, règles de branche, intégration continue, construction et attestation de l'artefact |
| **Processus semi-automatique local** | extrait `main`, résout l'artefact, charge un environnement, exécute le déploiement via `rr_run` |

### 5.2 La ligne de partage n'est pas « GitHub / hors GitHub »

Le critère qui tient est unique :

> **Cette étape a-t-elle besoin d'un secret donnant accès à des données réelles ?**

Non → intégration continue, sur pull request. Oui → poste de contrôle humain, jamais un exécuteur GitHub.

La raison est dans #44. Un exécuteur qui détient une clé SSH de production **est** un accès permanent à la production, détenu par un système qu'un contributeur influence en modifiant un fichier `.yml` — et le workflow modifié s'exécute *avant* la revue. `bash-deploy-libs` a déjà la contre-mesure : `CODEOWNERS` avec `.github/workflows/** @maintainers`. À reproduire dès le premier workflow.

### 5.3 Constat préalable — le dépôt n'est pas mergeable

Le ruleset `Protect main` de `Natixar/guyana` est **actif** et exige `non_fast_forward`, une PR avec une approbation (squash seul, résolution des fils obligatoire), **`code_scanning` par CodeQL** (seuils `errors` / `high_or_higher`) et **`code_quality`** (seuil `errors`).

Or `gh api .../actions/workflows` renvoie `total_count: 0`. **Aucun workflow n'existe**, et une règle de code scanning dont l'outil n'a jamais tourné ne passe pas au vert toute seule. C'est le point aveugle décrit dans #44 — « au mieux ça bloque, au pire ça rassure faussement » — sous forme vérifiée.

**Le premier `.yml` n'est donc pas un confort d'ingénierie : c'est ce qui rend le dépôt mergeable.** Il passe devant le reste.

### 5.4 Le point d'articulation : `verify/` est un artefact partagé

L'intégration continue n'« appelle » pas le dossier `deploy` : elle en est un **client**, au même titre qu'un opérateur humain.

```
deploy/steps/     ── exécuté par ──►  deploy.sh sur poste de contrôle   [secrets réels]
      │                           └►  job « ephemeral » en CI            [secrets jetables]
      │
deploy/verify/    ── exécuté par ──►  job « ephemeral » sur chaque PR
   (mêmes fichiers)                └►  cron nocturne contre la préproduction
                                   └►  deploy.sh après chaque déploiement
```

Un seul artefact, trois contextes — c'est ce qui garantit que ce qui est vérifié en intégration continue est ce qui est vérifié en production. Sans cela, la CI redéveloppe son propre déploiement et les deux divergent en trois mois.

Le contrat d'interface qui rend ce partage possible :

- chaque `steps/NN-*.sh` accepte `--dry-run` et une cible `local` ou `remote` ;
- `verify/*.bats` ne dépend que d'un **descripteur d'environnement** — URL de base, identifiants de test, deux tenants A et B — et **jamais de la topologie** ;
- aucun step ne lit un secret directement : tout passe par `secrets/fetch.sh`, dont l'implémentation en CI est un bouchon rendant des valeurs éphémères.

### 5.5 Ce que fait le workflow sur pull request

| Job | Exécute | Casse la PR si | Secret |
|---|---|---|---|
| `lint` | `shellcheck` (`.shellcheckrc` déjà écrit), **`detect_unguarded_calls.sh`**, `yamllint`, `docker compose config` | commande externe non gardée, compose invalide | aucun |
| `codeql` | CodeQL sur le code applicatif | **produit le check exigé par le ruleset** | aucun |
| `unit` | `bats deploy/test/*.bats` | régression sur la logique de déploiement | aucun |
| `contract` | régénère la carte route → permission depuis l'OpenAPI (A1/A2) | une route sans permission déclarée, ou une carte périmée | aucun |
| `ephemeral` | monte la pile depuis `deploy/`, exécute `deploy/verify/*.bats`, détruit | proxy mal configuré, RLS qui n'isole pas, port applicatif joignable hors proxy | jetables |

Les deux qui portent la valeur sont `contract` et `ephemeral`.

`contract` rend exécutable le critère d'acceptation de #39 : *une route non déclarée casse le build*. Aucun linter, aucun CodeQL ne donne cette garantie — elle est spécifique au vocabulaire de permissions de §2.1. C'est le seul job qu'on ne peut pas acheter.

**`ephemeral` devient critique précisément parce que GitHub ne déploie pas.** Si `deploy/steps/` n'est exercé qu'au moment du déploiement réel, il n'est testé qu'au pire moment possible. Le job `ephemeral` est le **seul exercice automatique et fréquent** que le code de déploiement reçoit.

```yaml
# .github/workflows/pr.yml — extrait du job qui compte
  ephemeral:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }          # bash-deploy-libs
      - run: deploy/secrets/fetch.sh --ephemeral # secrets jetables
      - run: deploy/steps/20-runtime.sh  --target=local
      - run: deploy/steps/30-network.sh  --target=local
      - run: deploy/steps/40-proxy.sh    --target=local
      - run: deploy/steps/55-database.sh --target=local
      - run: deploy/steps/60-app.sh      --target=local
      - run: bats deploy/verify/*.bats            # les invariants de sécurité
      - if: always()
        run: deploy/steps/99-teardown.sh
```

Si `verify-network.bats` constate qu'un port applicatif est joignable hors du proxy, **la PR est rouge** : D3 devient une propriété vérifiée à chaque changement. Idem pour `verify-rls.bats` — un rôle applicatif qui voit les données d'un autre tenant casse la PR. C'est la seule défense réaliste contre le `WHERE organization_id = ?` oublié, parce qu'elle ne repose sur la vigilance de personne.

Note : `bash-deploy-libs` teste déjà ses bibliothèques dans son propre CI. Celui de `guyana` ne les reteste pas, il les consomme en sous-module épinglé.

### 5.6 Les autres workflows

| Fichier | Déclencheur | Rôle |
|---|---|---|
| `pr.yml` | `pull_request` | les cinq jobs ci-dessus |
| `main.yml` | `push: main` | reconstruction, **signature et attestation de provenance**, publication de l'image **par digest** |
| `nightly.yml` | `schedule` | `deploy/verify/*` contre la préproduction — détecte la **dérive**, ce qu'une vérification post-déploiement ne fait pas |
| `release.yml` | `tag` | fige le digest et produit le manifeste de déploiement |

L'attestation de `main.yml` relie « source revue en PR » et « artefact qui tourne » — le palier 5 de #44 est inatteignable sans elle. C'est la raison technique pour laquelle `image: fusionauth/fusionauth-app:latest` n'est pas un détail : **on ne peut pas attester un tag mobile.**

### 5.7 Le lanceur semi-automatique

`deploy/deploy.sh`, exécuté depuis un poste de contrôle, jamais depuis un exécuteur :

1. récupère et **vérifie** `origin/main` à un commit donné ;
2. résout le **digest attesté** correspondant à ce commit, et **refuse** s'il n'y a pas d'attestation ;
3. charge le descripteur d'environnement `inventory/hosts.d/<env>.env` — serveur cible, domaines, ports — **sans aucun secret** ;
4. obtient les secrets à l'exécution via `secrets/fetch.sh`, avec les identifiants de l'opérateur, sans jamais les persister ;
5. exécute `steps/` sur la cible via `rr_run` — donc **sans écrire un fichier sur l'hôte distant** ;
6. exécute `verify/` contre le résultat ;
7. écrit un **enregistrement de déploiement** : qui, quand, quel commit, quel digest, quel environnement, résultat des vérifications.

Ce que « semi-automatique » désigne exactement : l'humain fournit **l'intention** — quel commit, quel environnement — et **le justificatif d'accès**. Le reste est mécanique. C'est précisément la propriété recherchée par #44 : pas d'accès permanent à la production, l'élévation est un acte, et cet acte laisse une trace.

Quatre règles :

- **Déploiement par digest, jamais par tag ni par branche.** `main` sert à choisir le commit ; ce qui est déployé est le digest attesté de ce commit.
- **`--dry-run` par défaut.** L'exécution réelle demande une confirmation explicite.
- **Idempotent et rejouable.** Relancer le même déploiement ne doit rien casser.
- **Le lanceur ne détient aucun secret de longue durée.** Il en emprunte le temps de l'exécution.

L'enregistrement de l'étape 7 est l'événement ancrable du lot 4 (#44) : il alimente le journal d'accès administratif inviolable sans effort supplémentaire.

---

## 6. Séquencement

### Lot 1 — Socle (bloquant, rien ne peut avancer sans)

1. Intégrer `bash-deploy-libs` en sous-module ; câbler `shellcheck`, `bats` et `detect_unguarded_calls.sh` en CI sur `deploy/`.
2. **Trancher la gestion des secrets.** Décision bloquante, cf. §7.
3. `00-preflight` + `10-hardening` + le `verify/` correspondant. Un hôte doit pouvoir être reconstruit de zéro et passer les vérifications.

### Lot 2 — Chemin d'accès (c'est la sécurité que la réunion a décidée)

4. `30-network` + `40-proxy` : matérialiser D3 (rien n'est joignable hors du proxy) et le rendre **vérifiable** par `verify-network.bats`.
5. `50-identity` : couche 0 de #39. **FusionAuth retenu** (fiche séparée). Si l'instance Cloud managée est choisie, ce step disparaît et est remplacé par `52-identity-config.sh` — réconciliation de la configuration déclarative (CI **B5**) via l'API cliente.
6. `55-database` : rôles PostgreSQL et RLS. C'est ici que D2 (marquage de propriété sur chaque élément de donnée) devient une contrainte que la base fait respecter, et non une convention de code.

### Lot 3 — Données

7. `58-timeseries` — après la décision de dimensionnement de #43.
8. `80-backup` avec **restauration testée**. Une sauvegarde non restaurée n'existe pas.

### Lot 4 — Opposabilité (#44)

9. `70-observability` : journal d'accès administratif inviolable.
10. `breakglass/` : élévation temporaire, k-parmi-n, détenteurs dans des juridictions distinctes.
11. Ancrage du journal (#40), une fois la chaîne choisie.

---

## 7. Décisions ouvertes

**Bloquantes pour le lot 1 :**

1. **Où vivent les secrets ?** Coffre (Vault / OpenBao), secrets chiffrés dans le dépôt (SOPS + age), ou secrets de l'orchestrateur. Le choix conditionne `secrets/fetch.sh` et il conditionne aussi #44 : si le client doit détenir ses propres clés (BYOK/HYOK), l'adaptateur doit le permettre dès le départ. *Recommandation : SOPS + age pour le POC* — pas de composant serveur supplémentaire, chiffrement à la source, rotation possible, et cela n'interdit pas de migrer vers un coffre ensuite.
2. **VM ou conteneurs ?** Action A7, non tranchée en réunion. Le plan ci-dessus est neutre jusqu'à `20-runtime`.

**Bloquantes pour le lot 2 :**

3. **REST ou GraphQL ?** Décision ouverte n°3 de #39, et elle décide si le lot 2 a un sens : avec GraphQL tout passe par un unique `POST /graphql`, le proxy ne peut plus rien arbitrer et la couche 1 remonte dans l'application. **À trancher avant d'écrire `40-proxy`.**
4. **Auto-hébergé ou FusionAuth Cloud managé ?** Le produit est retenu ; le mode d'hébergement ne l'est pas. Le managé supprime `50-identity` du dossier et l'essentiel de l'exploitation, au prix d'une dépendance externe sur le chemin d'authentification. Cf. fiche FusionAuth §7.
5. **Comment versionner la configuration d'identité (CI B5) ?** Kickstart, réconciliation par l'API, ou export/restauration — les trois n'ont pas les mêmes propriétés et une seule est réellement versionnable. Cf. fiche FusionAuth §6.3.

**Déjà tranchées le 28/07, et à reporter dans les issues :**

- **D1 — instance SaaS unique multi-clients.** Cela ferme la décision ouverte n°2 de #39 et le premier critère d'acceptation de #18. À commenter sur les deux issues.
- **D2 — marquage de propriété sur chaque élément de donnée.** C'est la couche 2 de #39, et cela rend le RLS obligatoire plutôt qu'optionnel : sur une instance unique, il n'y a plus d'isolation d'infrastructure pour rattraper un `WHERE` oublié.
- **D3 — pas d'accès direct au site, proxy obligatoire.**

**Tranchées depuis (28/07, en séance de travail) :**

- **GitHub ne déploie pas.** Supervision, gestion et intégration continue sur GitHub ; déploiement par un lanceur semi-automatique local qui extrait `main` et l'applique à un environnement nommé (§5.1, §5.7). Une application GitHub est écartée pour le POC : trop lourde à écrire, tester et déployer, et elle recrée la surface d'accès permanent que #44 cherche à supprimer.
- **FusionAuth pour la couche 0**, auto-hébergé d'abord, sous condition de portabilité de la configuration vers le Cloud — ce qui fait du script de réconciliation un prérequis et non un confort.
- **Ancrage : Algorand + OpenTimestamps**, derrière un pilote interchangeable, en priorité basse.

---

## 8. Le point qu’il ne faut pas laisser passer

D1 (instance unique partagée) et #44 (confidentialité vis-à-vis de l'opérateur) tirent en sens opposé, et le dossier de déploiement est l'endroit où cette tension devient concrète ou reste théorique. Sur une instance mutualisée dont Natixar administre la base, **RLS ne protège rien contre Natixar** — un superutilisateur le contourne.

Ce que le dossier de déploiement peut honnêtement livrer, et qui suffit commercialement :

> Chaque accès à vos données est journalisé, le journal est inviolable, aucun accès n'est possible par une seule personne, et vous détenez les clés des champs sur lesquels nous n'avons pas besoin de calculer.

C'est une promesse de **détection et de non-répudiation**, pas d'impossibilité. Elle survit à un audit. Et elle est presque entièrement livrée par les lots 1, 2 et 4 ci-dessus — c'est-à-dire par des scripts de déploiement, pas par de la cryptographie avancée.
