# Écarts entre le plan et la réalité

Le plan du 28 juillet décrivait l'intention ; la note de méthode du 30 juillet
décrit ce qui existe. Les confronter a produit la liste ci-dessous. Elle est
tenue à jour : un écart fermé le reste, un écart ouvert porte sa mesure.

Suivi : issue #55.

| # | Le plan supposait | La réalité sur kubb | Mesure | Statut |
|---|---|---|---|---|
| 1 | nous possédons l'hôte et le durcissons | **nous le possédons bien.** Mais Docker et Traefik y sont installés et gérés par un *autre projet* (script d'installation Traefik, vague 2), et OpenERP y tourne en LXC via Juju | `20-runtime` supprimé : l'installation de Docker appartient au script Traefik, et deviendra `ensure_docker` en vague 3. `10-hardening` **réintroduit** : le durcissement raisonnable du POC nous revient | **rouvert** |
| 2 | `40-proxy.sh` installe et configure Traefik | Traefik est **géré en configuration par un autre projet**. Une édition manuelle de sa configuration serait écrasée à la prochaine exécution de ce script | step supprimé — non par défaut de droits, mais parce qu'une modification hors du projet qui le gère ne survivrait pas. Le routage passe par des labels sur nos conteneurs | **fermé, motif corrigé** |
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

---

## Écarts ajoutés le 30/07 après clarification sur kubb

| # | Constat | Mesure | Statut |
|---|---|---|---|
| 13 | **kubb nous appartient.** La prémisse « nous sommes locataires », sur laquelle reposait la première version de ce fichier, était fausse. Ce qui reste vrai, c'est que Traefik est géré par un autre projet — le motif change, la règle tient | motifs corrigés aux écarts 1 et 2 ; `10-hardening.sh` réintroduit au périmètre | **rouvert** |
| 14 | Sous-domaines **réservés** : `whoami.*` (fonction de test), `portal.*`, et le sous-domaine de Traefik lui-même (filtré LAN uniquement). Tout le reste est disponible | inscrit dans le descripteur d'environnement pour qu'un futur déploiement ne les revendique pas | **fermé** |
| 15 | **OpenERP est le seul service opérationnel** de kubb. Il tourne en **LXC via Juju**, pas en Docker, et son fichier de routage `juju-gourou-openerp-server.yml` est **généré automatiquement** depuis les données Juju | à ne jamais éditer à la main ; à traiter comme une sortie de programme. La non-régression des voisins le couvre | **fermé** |
| 16 | Mes steps appellent `ssh` directement au lieu d'utiliser `rr_run`. C'est exactement l'anti-motif de la vague 2 — du spécifique à 100 % — que la vague 3 existe pour éviter | câbler `bash-deploy-libs` en sous-module et passer par `rr_run` | **ouvert, prioritaire** |
| 17 | Mes scripts ne respectent pas la doctrine des trois vagues : **accompagner l'utilisateur**. Pas de gestion de l'agent SSH, pas de message de remédiation, pas d'aperçu du changement avant exécution | `deploy.sh` révisé : agent SSH avec expiration, diagnostic précis, aperçu | **fermé** |
| 18 | `ensure_docker` n'est pas un simple manque de la bibliothèque : c'est **le dernier module qui bloque la migration du script Traefik en vague 3** | à traiter dans le dépôt `bash-deploy-libs`, avec cette priorité | **ouvert, hors de ce dépôt** |

## Sur les trois vagues d'automatisation

Le contexte, parce qu'il commande la manière d'écrire ici :

- **Vague 1** — haproxy, sans intégration Docker, figée sur une version ancienne, seule la configuration étant versionnée. Écrite à la main.
- **Vague 2** — le script d'installation de Traefik : installe Docker si besoin, copie les clés, ne demande qu'un accès SSH. Meilleure, écrite avec assistance IA, mais **spécifique à 100 %**.
- **Vague 3** — `bash-deploy-libs` : modulaire, découplée, conçue pour et par l'IA. Traefik n'y a pas encore migré parce que `ensure_docker` manque.

Une constante des trois vagues, et c'est un critère d'acceptation implicite que
mes scripts ne remplissaient pas : **les scripts accompagnent l'utilisateur.**
Ils lancent l'agent SSH avec une expiration, ils sont précis quand ils demandent
un mot de passe, ils expliquent. Un script correct mais taciturne n'est pas
conforme à cette doctrine.
