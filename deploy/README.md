# deploy/ — instructions de déploiement, exécutables

> **Une instruction de déploiement qui n'est pas exécutable n'est pas une
> instruction de déploiement : c'est un vœu.**

Ce répertoire n'est pas de la documentation d'exploitation. C'est un ensemble
d'artefacts exécutables, testés et rejouables.

## Les invariants

Ils sont énoncés ici et **vérifiés** par `verify/`. Un invariant qui ne peut pas
faire échouer une vérification est décoratif.

1. **Traefik est géré par un autre projet.** kubb nous appartient, mais son
   Traefik est installé et configuré par un script dédié — deuxième vague
   d'automatisation, en attente de migration vers `bash-deploy-libs`. Une
   édition manuelle de sa configuration serait **écrasée à la prochaine
   exécution de ce script**. Le déploiement Guyana ne touche donc ni
   `traefik.yml`, ni `/home/traefik/routing`, ni les certificats : tout notre
   routage passe par des labels sur nos propres conteneurs.
   *Corollaire* : `juju-gourou-openerp-server.yml` est **généré** depuis les
   données Juju. C'est une sortie de programme, jamais une source.
2. **Aucun port publié.** Traefik joint le conteneur par son nom sur le réseau
   `proxy`. Un `-p` serait une exposition directe.
3. **Le contenu vit dans l'image**, jamais en bind mount : une image a un
   digest, s'atteste et se déploie par digest ; un répertoire déposé sur
   l'hôte, non. L'état persistant va dans des volumes nommés.
4. **Rien ne s'écrit sur la cible.** Contexte de construction et scripts
   voyagent par stdin.
5. **Un secret transite par stdout et n'est jamais persisté**, ni ici ni là-bas.
6. **Nos routeurs sont préfixés** `guyana-` : l'espace de noms de Traefik est
   global et rien n'empêche techniquement une collision avec un voisin.
7. **Les sous-domaines réservés ne sont jamais revendiqués** : `whoami.*`,
   `portal.*`, et celui de Traefik, filtré LAN. Le reste est disponible.
8. **Les voisins ne cassent pas.** C'est la vérification qui compte le plus —
   OpenERP, en LXC via Juju, est le seul service opérationnel de la machine.

## Usage

```bash
./deploy/deploy.sh --env kubb              # simulation (défaut)
./deploy/deploy.sh --env kubb --apply      # exécution réelle
./deploy/deploy.sh --env kubb --teardown
bats deploy/verify/*.bats                  # après coup, ou en cron
```

`--apply` refuse de s'exécuter sur un arbre de travail modifié : ce qui est
déployé doit être ce qui est commité.

## Organisation

| | |
|---|---|
| `deploy.sh` | lanceur semi-automatique : l'humain fournit l'intention et le justificatif d'accès, le reste est mécanique |
| `inventory/hosts.d/*.env` | descripteurs d'environnement — topologie, **jamais de secret** |
| `secrets/fetch.sh` | adaptateur unique vers la source de secrets (bouchon aujourd'hui, interface définitive) |
| `steps/` | ce qui agit sur la cible, exécuté par stdin |
| `verify/` | ce qui affirme les invariants — **spécification**, pas tests d'implémentation |
| — | le contenu déployé vient de `site/`, construit par Hugo. `skeleton/` a été retiré : il était marqué temporaire et l'application existe désormais |
| `GAPS.md` | écarts entre le plan et la réalité, avec leur statut |

## Pourquoi `verify/` est séparé de `steps/`

`verify-network.bats` affirme *« le conteneur ne publie aucun port »*. Cet
énoncé est vrai indépendamment de la manière dont `60-app.sh` s'y prend, et il
doit rester vrai si l'on passe de Docker à Podman. C'est une **spécification**.
Les tests unitaires des fonctions de `steps/`, eux, resteront avec `steps/`.

C'est aussi ce qui permet aux mêmes fichiers de tourner dans trois contextes :
le job d'intégration continue, un cron nocturne contre la préproduction, et
`deploy.sh` après chaque déploiement.

## L'existant côté proxy

Documenté dans `analyses/2026-07-30_methode-deploiement-conteneurs.md` :
Traefik v3.4, deux fournisseurs (`file` et `docker`), `exposedbydefault: false`,
fournisseur docker épinglé sur le réseau `proxy`, certificats provisionnés par
fichier sans ACME, journal d'accès filtré sur les codes 4xx/5xx.

## La doctrine des scripts

Commune aux trois vagues d'automatisation de ce parc, et critère d'acceptation
à part entière : **un script accompagne son utilisateur.**

- il gère l'agent SSH lui-même, avec une expiration, plutôt que d'exiger qu'on
  l'ait préparé ;
- il est précis quand il demande une phrase de passe, et dit combien de temps
  elle restera en mémoire ;
- il montre ce qu'il va faire **avant** de le faire, y compris ce qu'il ne
  touchera pas ;
- quand il échoue, il donne la commande qui répare, pas seulement le
  diagnostic.

Un script correct mais taciturne n'est pas conforme. `deploy.sh` a été révisé
pour cela le 30 juillet.

## Dette assumée

`deploy.sh` appelle `ssh` directement au lieu de passer par `rr_run`. C'est
l'anti-motif de la deuxième vague — du spécifique à 100 % — que la troisième
existe précisément pour éviter. Le câblage de `bash-deploy-libs` en sous-module
est la prochaine étape ; c'est l'écart 16 de `GAPS.md`.
