# 02 — static-web-server

*État constaté le 8 septembre 2026, version **2.44.0**. Les comportements notés
« mesuré » l'ont été sur `ghcr.io/static-web-server/static-web-server:2` avec les
drapeaux exacts de `deploy/steps/60-app.sh`, et non lus dans la documentation.*

---

## Ce que c'est

[static-web-server](https://static-web-server.net/) (SWS), de Jose Quintana :
un serveur de fichiers statiques écrit en Rust, asynchrone, distribué comme un
**binaire unique sans dépendance**. Sous licence MIT/Apache-2.0.

Pourquoi celui-ci plutôt que nginx ou Caddy : l'image fait **8,4 Mo en deux
couches** et ne contient rien d'autre que le binaire. Pas de shell, pas de
gestionnaire de paquets, pas de fichier de configuration à surveiller. Sur une
machine partagée où nous sommes locataires, la surface la plus facile à
défendre est celle qui n'existe pas.

---

## Organisation du conteneur

### L'image de base

```
ghcr.io/static-web-server/static-web-server:2
├─ Entrypoint : ["/static-web-server"]
├─ Cmd        : (aucune)
├─ User       : (vide)
├─ Expose     : 80/tcp
├─ WorkingDir : /
├─ Couches    : 2
└─ Taille     : 8 380 351 octets
```

Deux conséquences pratiques de ce tableau.

**L'`Entrypoint` est le binaire lui-même**, sans `Cmd`. Tout ce qui suit le nom
de l'image dans `docker run` est donc passé **directement au serveur** comme
arguments de ligne de commande. C'est ce qui explique la forme de notre
lancement, qui n'a l'air de rien mais n'est pas anodine :

```bash
docker run -d --name guyana-site ... aurora-site \
  --root=/public --port=80 --page-fallback=/public/index.html \
  --compression=true --cache-control-headers=false
```

Il n'y a pas de fichier de configuration dans notre montage : **la configuration
est la ligne de commande**, et elle est lisible en entier dans `60-app.sh`.

**Il n'y a pas de shell dans l'image.** `docker exec guyana-site sh` échoue, et
même `id` n'existe pas. On ne peut donc pas inspecter le conteneur en marche de
l'intérieur : le diagnostic se fait par `docker logs`, par `docker inspect`,
ou en interrogeant le serveur par HTTP. C'est un coût réel en exploitation, et
la contrepartie de la surface réduite.

> **`User` est vide : le processus tourne en root dans le conteneur.** L'éditeur
> publie aussi des variantes *rootless* (utilisateur `sws`, racine publique
> `/home/sws/public`) que nous n'utilisons pas. Ce n'est pas gratuit ; c'est
> partiellement compensé par `--read-only`, `--security-opt
> no-new-privileges:true`, l'absence de shell et l'absence de port publié.

### Notre image

Le Dockerfile fait deux lignes, engendrées par le lanceur :

```dockerfile
FROM ghcr.io/static-web-server/static-web-server:2
COPY public/ /public/
```

`public/` est la sortie de Hugo, construite sur le poste de contrôle. Le
contexte de construction part par `stdin` : rien ne s'écrit sur kubb.

> **L'étiquette `:2` est mobile.** Elle désigne aujourd'hui la 2.44.0 ; elle
> désignera demain la 2.45. Ce qui tourne peut donc changer sans qu'aucune ligne
> du dépôt ne change. `DB_IMAGE` est épinglée par `sha256:` ; celle-ci ne l'est
> pas.

### Le durcissement, et d'où il vient

| Mesure | Posée par |
|---|---|
| `--read-only` + `--tmpfs /tmp` | `docker run` |
| `--security-opt no-new-privileges:true` | `docker run` |
| aucun port publié | `docker run`, **et vérifié** après coup |
| `--restart unless-stopped` | `docker run` |
| TLS, en-têtes de sécurité, authentification | **Traefik**, pas SWS |

Le serveur statique ne fait, dans ce montage, que servir des octets. Tout ce qui
relève de la sécurité de transport et d'accès est délégué au proxy — voir la
note [01](01_hebergement-et-routage.md).

---

## Ce que SWS sait faire

### Ce que nous utilisons

| Option | Valeur | Pourquoi |
|---|---|---|
| `--root` | `/public` | la racine servie |
| `--port` | `80` | Traefik joint le conteneur par son nom sur le réseau `proxy` |
| `--page-fallback` | `/public/index.html` | routage côté client : toute URL inconnue rend la page d'accueil |
| `--compression` | `true` | gzip/brotli/zstd/deflate à la volée |
| `--cache-control-headers` | **`false`** | pour que Traefik soit **seul** émetteur de `Cache-Control` |

### Ce que nous n'utilisons pas, et pourquoi

| Option | Ce qu'elle ferait | Pourquoi pas ici |
|---|---|---|
| `--basic-auth` | authentification HTTP simple | c'est Traefik qui authentifie, et lui seul sait poser `X-Webauth-User` |
| `--security-headers` | pose un jeu d'en-têtes de sécurité | même règle : un seul émetteur par en-tête |
| `--cors-allow-origins` | CORS | le site n'est appelé que par lui-même |
| `--health` | point `/health` | Traefik ne s'en sert pas dans ce montage |
| `--metrics` | export Prometheus | pas de collecte sur kubb |
| `--directory-listing` | index de répertoire | exposerait l'arborescence |
| `--page404`, `--page50x` | pages d'erreur | `--page-fallback` les court-circuite |
| `--http2`, `--https-redirect` | TLS terminé par SWS | c'est Traefik qui termine TLS |
| `--maintenance-mode` | 503 volontaire | jamais eu l'usage |
| `--disable-symlinks` | refuse de suivre les liens | l'image n'en contient pas |
| `--ignore-hidden-files` | dotfiles | **laissé au défaut, qui les refuse — voir « deux comportements mesurés » plus bas** |

### La configuration avancée, par fichier TOML

Au-delà de la ligne de commande, SWS accepte `--config-file=/chemin/sws.toml`,
qui **seul** donne accès à quatre mécanismes. Nous n'en utilisons aucun
aujourd'hui.

**Hôtes virtuels** — une racine différente par en-tête `Host` :

```toml
root = "/public"

[advanced]
[[advanced.virtual-hosts]]
host = "autre.example.com"
root = "/autre-racine"
```

**En-têtes par motif** — `[[advanced.headers]]`, avec un `source` en glob.

**Réécritures internes** — `[[advanced.rewrites]]`, `source`/`destination`, avec
groupes de capture ; peuvent viser un hôte virtuel « interne » pour exposer une
autre racine.

**Redirections** — `[[advanced.redirects]]`, avec `host`, `source`,
`destination` et `kind` (301/302).

> Passer au fichier TOML change la nature du montage : la configuration cesse
> d'être lisible dans `60-app.sh` et devient un fichier de plus à copier dans
> l'image, à versionner et à tenir à jour. Ce n'est pas un détail de forme —
> c'est un élément de configuration supplémentaire.

---

## Deux comportements mesurés, qui surprennent

### 1. Les fichiers cachés sont refusés par défaut

**SWS ignore les dotfiles**, répond 404, et les omet des index. C'est un choix
de sécurité de l'éditeur, et il s'applique aux **répertoires** aussi bien qu'aux
fichiers : `.well-known/` est donc invisible.

Mesuré sur notre image, avec nos drapeaux :

```
GET /.well-known/did.json   ->  200   content-type: text/html   (corps = index.html)
GET /engine/taxonomy.json   ->  200   content-type: application/json
```

**Le 404 ne se voit pas.** `--page-fallback` le transforme en 200 portant la
page d'accueil. Qui demande un fichier caché ne reçoit pas une erreur : il
reçoit du HTML annoncé comme un succès.

Le document DID de Natixar n'est pas servi ici : il vit sur le domaine
principal, chez Netlify — voir [01](01_hebergement-et-routage.md). Le
comportement décrit vaut pour tout chemin caché de ce site.

Avec `--ignore-hidden-files=false` ajouté, le même appel rend :

```
GET /.well-known/did.json   ->  200   content-type: application/json   (le bon corps)
```

Un seul drapeau. Mais il lève la protection **pour tous les dotfiles de la
racine**, pas seulement pour `.well-known/` — l'option n'a pas de granularité.
Sur une racine engendrée par Hugo, cela mérite qu'on regarde ce qu'elle contient.

### 2. Le serveur est muet

Le niveau de journalisation par défaut est **`error`**. Le conteneur déployé
n'écrit donc rien dans `docker logs` — pas même les 404. Vérifié : un conteneur
lancé comme en production, sollicité sur une URL absente, produit zéro ligne.

Avec `--log-level=info`, SWS écrit à l'amorçage un récapitulatif complet de sa
configuration effective — chaque option et sa valeur retenue — puis une ligne
par requête :

```
INFO static_web_server::server: static-web-server 2.44.0
INFO static_web_server::log_addr: incoming request: method=GET uri=/absent
WARN static_web_server::error_page: method=GET uri=/absent status=404 error="Not Found"
```

Ce récapitulatif est le moyen le plus direct de savoir ce que le serveur croit
faire. Le journal d'accès de Traefik, lui, est filtré sur les codes 4xx/5xx —
et comme `--page-fallback` rend 200 pour tout chemin inconnu, les URL manquantes
du site n'y figurent pas non plus.

---

## Le procédé de déploiement

```
1. hugo                       sur le poste de contrôle ; échec = arrêt
2. cp public/ + Dockerfile    dans un répertoire temporaire
3. tar | ssh docker build -   contexte par stdin, image construite SUR kubb
4. docker image inspect       l'image présente doit être celle qu'on vient de bâtir
5. docker rm -f + docker run  avec les étiquettes de routage
6. docker inspect             aucun port publié — vérifié, pas supposé
7. deployments.log            date, opérateur, environnement, commit, id d'image
```

Le conteneur est **recréé** à chaque déploiement, jamais mis à jour : les
étiquettes Docker ne sont pas modifiables à chaud, et le conteneur ne porte
aucun état.

L'étape 4 est une mesure d'attente assumée. Le plan exige un déploiement par
digest attesté ; tant que le registre et la chaîne d'attestation n'existent pas,
on se contente de refuser toute divergence entre l'image demandée et celle
réellement présente sur la cible.

La CI (`.github/workflows/pr.yml`, job `ephemeral`) rejoue la même construction
sur un runner et interroge le site, avec `--page-fallback` seul — sans
`--compression` ni `--cache-control-headers=false`. Elle y vérifie
`/inconnu -> 200`, le comportement attendu d'une application à routage côté
client.

---
