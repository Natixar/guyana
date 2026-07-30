# deploy/ — instructions de déploiement, exécutables

> **Une instruction de déploiement qui n'est pas exécutable n'est pas une
> instruction de déploiement : c'est un vœu.**

Ce répertoire n'est pas de la documentation d'exploitation. C'est un ensemble
d'artefacts exécutables, testés et rejouables.

## Les invariants

Ils sont énoncés ici et **vérifiés** par `verify/`. Un invariant qui ne peut pas
faire échouer une vérification est décoratif.

1. **Nous sommes locataires de kubb.** Le déploiement ne modifie ni la
   configuration de Traefik, ni `/home/traefik/routing`, ni les certificats, ni
   le projet Compose du proxy. Tout notre routage passe par des labels sur nos
   propres conteneurs.
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
7. **Les voisins ne cassent pas.** C'est la vérification qui compte le plus.

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
| `skeleton/` | contenu de l'image du squelette. Temporaire : appartient au CI applicatif dès qu'il existe |
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
