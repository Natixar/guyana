# Écarts entre le plan et la réalité

Le plan du 28 juillet décrivait l'intention ; la note de méthode du 30 juillet
décrit ce qui existe. Les confronter a produit la liste ci-dessous. Elle est
tenue à jour : un écart fermé le reste, un écart ouvert porte sa mesure.

Suivi : issue #55.

| # | Le plan supposait | La réalité sur kubb | Mesure | Statut |
|---|---|---|---|---|
| 1 | nous possédons l'hôte et le durcissons | machine préexistante, durcie, Docker et Traefik déjà en service — nous sommes **locataires** | `10-hardening` et `20-runtime` supprimés ; remplacés par des **assertions** dans `00-preflight` | **fermé** |
| 2 | `40-proxy.sh` installe et configure Traefik | nous ne touchons jamais Traefik ; le routage se déclare en labels sur nos conteneurs | step supprimé ; le routage fait partie de `60-app.sh` | **fermé** |
| 3 | la décision « où vivent les secrets » bloque le lot 1 | une page statique publique n'a aucun secret | `secrets/fetch.sh` livré en bouchon **avec son interface définitive** | **fermé** |
| 4 | `ensure_docker.sh` installe le runtime | Docker 26.1.3 déjà présent | ce qu'il fallait n'était pas une installation mais une **assertion** de runtime, de groupe et de réseau | **fermé** |
| 5 | la configuration s'écrit en fichiers sur la cible | `rr_run` n'accorde aucun droit d'écriture, et écrire laisse un résidu | tout passe par stdin ; `rr_put` demandé séparément dans le dépôt de bibliothèques | **fermé ici** |
| 6 | déploiement par **digest attesté** | le squelette tourne depuis une étiquette construite sur la cible | mesure d'attente : l'identifiant d'image est relevé à la construction, comparé avant lancement, et consigné dans `deployments.log`. La cible exige une chaîne d'intégration continue et un registre | **ouvert** |
| 7 | `verify/` en suite bats | cinq contrôles `curl` ad hoc dans une transcription | convertis en `deploy/verify/*.bats` — 9 assertions, passent contre le déploiement réel | **fermé** |
| 8 | *(absent du plan)* | la **non-régression des voisins** est le vrai risque d'une infrastructure partagée | `verify-neighbours.bats` ajouté ; c'est la vérification à ne jamais sauter | **fermé** |
| 9 | `deploy.sh` décrit au §5.7 | inexistant | écrit, `--dry-run` par défaut, refuse un arbre modifié, journalise chaque déploiement | **fermé** |
| 10 | des gates d'intégration continue font respecter les règles | **zéro workflow**, alors que le ruleset exige `code_scanning` (CodeQL) et `code_quality` | `.github/workflows/pr.yml` ajouté | **partiel — voir ci-dessous** |
| 11 | *(absent du plan)* | l'espace de noms des routeurs Traefik est global et sans protection | convention `guyana-*`, écrite dans le README et appliquée par `60-app.sh` | **fermé** |
| 12 | *(absent du plan)* | IPv6 a disparu du poste de contrôle ; `ssh` part sur l'AAAA et échoue | `-4` inscrit dans le descripteur d'environnement | **fermé** |

## L'écart n° 10 mérite un développement

Le ruleset `Protect main` exige un contrôle `code_scanning` produit par **CodeQL**.
Or **CodeQL ne sait pas analyser Bash**, et le dépôt ne contient aujourd'hui que
des scripts shell et du Markdown.

Le seul langage analysable en l'état est **`actions`**, qui couvre les fichiers
de workflow eux-mêmes. C'est ce que fait `pr.yml`. Cela produit un vrai résultat
CodeQL et devrait satisfaire la règle, mais il faut le dire franchement : **cela
n'analyse pas notre code de déploiement.** Ce sont `shellcheck` et, à terme,
`detect_unguarded_calls.sh` qui remplissent ce rôle — sans être reconnus par le
ruleset.

Deux points à confirmer à la première pull request :

1. la règle `code_scanning` accepte-t-elle un résultat CodeQL portant sur
   `actions` seul ;
2. la règle `code_quality` est-elle satisfaite par ce workflow, ou exige-t-elle
   une activation au niveau du dépôt.

**Tant que ces deux points ne sont pas vérifiés, aucune pull request ne peut
être fusionnée.** C'est le premier obstacle à lever, avant tout autre travail.

## L'écart n° 6 est le plus structurant

Déployer par digest attesté suppose : une construction en intégration continue,
un registre, la signature de provenance, et un lanceur qui refuse une image sans
attestation. C'est le §5.6 du plan. La mesure d'attente en place — relever
l'identifiant d'image et refuser toute divergence — protège contre la substitution
accidentelle, **pas** contre un artefact non revu. Elle ne doit pas être prise
pour la solution.
