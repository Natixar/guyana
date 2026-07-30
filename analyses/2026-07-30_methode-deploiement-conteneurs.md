# Méthode de déploiement des conteneurs applicatifs sur kubb

*Note opérationnelle, 30 juillet 2026. Document local, non versionné. Complète le plan du dossier de déploiement ; celui-ci décrit l'intention, celle-ci décrit ce qui existe et comment on s'y branche.*

---

## 1. Objet

Décrire la manière de déployer un conteneur applicatif derrière le Traefik existant de kubb, et documenter cet existant — qui n'était écrit nulle part.

**Provenance de l'information.** Tout ce qui suit a été relevé sur la machine le 29 et le 30 juillet 2026, pas déduit. Les fichiers de configuration appartiennent au compte `traefik` et ne sont pas lisibles directement par `claude-ia` ; ils ont été lus via `docker exec` sur le conteneur Traefik, ce que l'appartenance au groupe `docker` rend possible. C'est une illustration concrète du fait que ce groupe est équivalent à root, et la raison pour laquelle la demande de `sudo` a été retirée : elle n'aurait rien ajouté.

---

## 2. L'existant : le proxy Traefik de kubb

### 2.1 Déploiement

| | |
|---|---|
| Conteneur | `traefik-traefik-1`, image `traefik:v3.4`, en service depuis 8 jours au moment du relevé |
| Projet Compose | `traefik`, répertoire de travail `/home/traefik`, fichier `/home/traefik/docker-compose.yml` |
| Réseau | **`proxy`** — et uniquement celui-là |
| Service de référence | `traefik-whoami-1` (`traefik/whoami`), qui sert de modèle de style pour les labels |

### 2.2 Montages

```
/home/traefik/install/traefik.yml   -> /etc/traefik/traefik.yml   (ro)   configuration statique
/home/traefik/routing               -> /etc/traefik/routing       (ro)   configuration dynamique, provider file
/home/traefik/certs                 -> /certs                     (ro)   certificats publics
/home/traefik/secrets.d/*.pem       -> /run/secrets/*                    clés privées, en secrets Docker
/var/run/docker.sock                -> /var/run/docker.sock       (ro)   provider docker
```

### 2.3 Points d'entrée

- **`web`** sur `:80` — redirection **301 permanente** vers `websecure` en HTTPS. Rien n'est servi en clair.
- **`websecure`** sur `:443` — `http.tls: {}` active TLS au niveau du point d'entrée. Le commentaire du fichier est explicite : *self-signed si pas de certificat fourni*. C'est ce qui fait qu'un routeur sans certificat correspondant ne tombe pas en panne, mais sert un certificat auto-signé — un mode d'échec silencieux à connaître.

### 2.4 Fournisseurs de configuration — les deux

**`file`**, surveillant `/etc/traefik/routing`. Il contient aujourd'hui `tls.yml` et `juju-gourou-openerp-server.yml`. **Ce répertoire n'est pas le nôtre** : il porte la configuration TLS globale et les routes d'autres services. Nous n'y écrivons jamais.

**`docker`**, avec deux réglages qui commandent tout le reste :

```yaml
docker:
  exposedbydefault: false
  network: "proxy"
```

- `exposedbydefault: false` — **un conteneur est invisible tant qu'il ne porte pas `traefik.enable=true`.** C'est un bon défaut : rien ne s'expose par accident.
- `network: "proxy"` — le fournisseur ne cherche l'adresse du conteneur que sur ce réseau. **Un conteneur qui n'est pas sur `proxy` sera vu par Traefik mais restera injoignable.** C'est le piège le plus probable pour qui déploie ici la première fois.

### 2.5 TLS — provisionné par fichier, pas par ACME

`routing/tls.yml` définit un magasin `default` et y range les certificats :

```yaml
tls:
  stores:
    default:
      defaultCertificate:
        certFile: "/certs/Critical-202607-domain.cert.pem"
        keyFile: "/run/secrets/critical_private_key"
  certificates:
    - certFile: "/certs/Critical-202607-domain.cert.pem"      # critical-optimisation.com + *.
      keyFile: "/run/secrets/critical_private_key"
      stores: [default]
    - certFile: "/certs/natixarpro-202607-domain.cert.pem"    # natixar.pro + *.
      keyFile: "/run/secrets/natixarpro_private_key"
      stores: [default]
```

Présents dans `/certs` : `Critical-202607-domain.cert.pem`, `natixarpro-202607-domain.cert.pem`.
Présents dans `/run/secrets` : `calcool_private_key`, `critical_private_key`, `natixarpro_private_key` — la clé `calcool` est montée mais son certificat est commenté dans `tls.yml`.

**Aucun résolveur ACME n'est configuré.** Les certificats sont des bundles déposés à la main et renouvelés hors bande. Échéances relevées :

| Joker | Expire |
|---|---|
| `*.natixar.pro` | **19 août 2026** |
| `*.critical-optimisation.com` | 17 octobre 2026 |

Conséquence pratique pour un déploiement : **il n'y a rien à demander en matière de certificat.** Un routeur portant `tls=true` sans `certResolver` obtient automatiquement le bon certificat du magasin par défaut, choisi selon le SNI. C'est ce qui permet de déployer sur un nouveau sous-domaine sans introduire le moindre secret — ce qui est précisément la contrainte posée sur ce Traefik.

### 2.6 Tableau de bord, journalisation, extensions

- **Tableau de bord** : `api.dashboard: true`, `api.insecure: false`. Routeur `dashboard`, règle `HostRegexp((?i)^traefik\..*$)`, service `api@internal`, protégé par le middleware `dashboard-auth` en authentification basique. Vérifié de l'extérieur : renvoie 401.
- **Journalisation** : niveau `INFO`. Journal d'accès en **JSON**, filtré sur les codes `400-404` et `500-503` — les requêtes réussies ne sont pas journalisées — avec une liste blanche de champs (`RouterName`, `ServiceName`, `RequestHost`, `RequestPath`, `DownstreamStatus`…). À savoir avant de chercher une trace de requête réussie : elle n'existe pas.
- **`ping: {}`** activé — utile pour une sonde de disponibilité.
- **Extension expérimentale installée** : `github.com/TRIMM/traefik-maintenance` v1.0.1, middleware de page de maintenance. Disponible, non utilisé par nous à ce jour ; c'est l'outil tout indiqué si un déploiement doit afficher une page d'attente.

---

## 3. Les règles qui en découlent

1. **Nous sommes locataires.** Le déploiement Guyana ne modifie ni `traefik.yml`, ni `routing/`, ni les certificats, ni le compose de Traefik. Toute la configuration de routage passe par les **labels de nos propres conteneurs**.
2. **Réseau `proxy` obligatoire**, sinon le conteneur est injoignable.
3. **Aucun port publié.** Traefik atteint le conteneur par son nom sur `proxy`. Un `-p` serait une exposition directe, contraire à D3.
4. **`traefik.enable=true` explicite**, puisque rien n'est exposé par défaut.
5. **`tls=true` sans `certResolver`.** Le magasin par défaut fournit le certificat par SNI.
6. **Nommage préfixé des routeurs** — `guyana-*`. L'espace de noms des routeurs est global à l'instance, tous fournisseurs confondus : une collision avec un service voisin est possible et rien ne l'empêche techniquement.
7. **Une règle générique porte une priorité explicite et basse.** `HostRegexp` combiné à `priority=1` garantit qu'un futur routeur d'hôte exact l'emporte.
8. **Le contenu vit dans l'image**, jamais en bind mount : une image a un digest, s'atteste et se déploie par digest ; un répertoire déposé sur l'hôte, non. L'état persistant va dans des volumes nommés.
9. **Rien ne s'écrit sur l'hôte.** Le contexte de construction et les scripts voyagent par stdin.
10. **Durcissement systématique** : `--read-only`, `--tmpfs /tmp`, `--security-opt no-new-privileges:true`, `--restart unless-stopped`.

---

## 4. La séquence de déploiement

```
1. construire le contexte localement (Dockerfile + contenu)
2. ssh kubb 'docker build -q -t <image>:<version> -'  < contexte.tar
3. ssh kubb 'bash -s' <<'REMOTE'   … docker rm -f / docker run -d …   REMOTE
4. vérifier depuis l'Internet : code HTTP, TLS, contenu, redirection, voisins
```

Les étapes 2 et 3 passent toutes deux par stdin : aucun fichier intermédiaire n'est créé sur kubb, et le script exécuté est exactement celui qui se trouve sur le poste de contrôle au moment de l'exécution.

**Sur la recréation.** Les labels Docker ne sont pas modifiables sur un conteneur en marche : changer une règle de routage impose `docker rm -f` puis `docker run`. Pour un service réel, c'est là que le middleware de maintenance du §2.6 prend son sens.

---

## 5. L'exemple appliqué — le squelette

```bash
docker run -d --name guyana-hello \
  --network proxy --restart unless-stopped \
  --read-only --tmpfs /tmp --security-opt no-new-privileges:true \
  --label traefik.enable=true \
  --label 'traefik.http.routers.guyana-natixar.rule=Host(`guyana.natixar.pro`)' \
  --label traefik.http.routers.guyana-natixar.entrypoints=websecure \
  --label traefik.http.routers.guyana-natixar.tls=true \
  --label 'traefik.http.routers.guyana-co.rule=Host(`natixar.critical-optimisation.com`)' \
  --label traefik.http.routers.guyana-co.entrypoints=websecure \
  --label traefik.http.routers.guyana-co.tls=true \
  --label 'traefik.http.routers.guyana-any.rule=HostRegexp(`^(?i)guyana\..+$`)' \
  --label traefik.http.routers.guyana-any.entrypoints=websecure \
  --label traefik.http.routers.guyana-any.tls=true \
  --label traefik.http.routers.guyana-any.priority=1 \
  --label traefik.http.services.guyana-hello.loadbalancer.server.port=80 \
  guyana-hello:0.1 \
  --root=/public --port=80 --page-fallback=/public/index.html --compression=true
```

Trois routeurs, un seul service. Traefik émet un avertissement sur le routeur générique — *« No domain found in rule HostRegexp, the TLS options applied for this router will depend on the SNI of each request »* — et c'est exactement le comportement recherché : le certificat suit le nom demandé, donc le service répond sur tout `guyana.*` dont un joker couvre le domaine.

---

## 6. La vérification

Cinq contrôles, exécutés depuis l'extérieur après chaque déploiement, et destinés à devenir `deploy/verify/*.bats` :

| Contrôle | Attendu | Constaté le 29/07 |
|---|---|---|
| la page répond en HTTPS | 200, TLS validé | `HTTP 200 TLS=0` |
| le contenu est le bon | présence du marqueur attendu | `<h1>Hello world!</h1>` |
| redirection HTTP → HTTPS | 301 | `301 -> https://…` |
| repli d'application | 200 sur une URL inconnue | `200` |
| **non-régression des voisins** | inchangés | `whoami` 200, `traefik` 401, `natixar.pro` 200 |

Le cinquième est le seul qui compte vraiment. Sur une infrastructure partagée, le risque n'est pas que notre déploiement échoue — il est qu'il casse autre chose. C'est le contrôle à ne jamais sauter.

---

## 7. Limites et points ouverts

**Certificats renouvelés hors bande.** Aucun ACME. `*.natixar.pro` expire le 19 août, deux semaines après le départ du mainteneur et la veille de l'échéance FIDES. Traité en #54, où le déploiement d'ACME est prévu sur `natixar.pro`, `calcoolstudios.com`, `calcool.ai` et `critical-optimisation.com`.

**Le socket Docker est monté dans Traefik**, en lecture seule. C'est le risque connu du fournisseur docker : quiconque peut écrire des labels influence le routage. Un proxy de socket serait le correctif ; ce n'est pas notre décision, c'est celle de l'exploitant de kubb.

**`claude-ia` appartient au groupe `docker`, donc dispose d'un équivalent root.** Documenté dans #53, non atténué : c'est un compromis assumé pour le POC, dont la contrepartie est la révocabilité en une commande.

**L'espace de noms des routeurs est partagé** et rien n'empêche une collision entre projets. La convention de préfixe est la seule protection.

**Les requêtes réussies ne sont pas journalisées.** Le journal d'accès filtre sur `400-404` et `500-503`. Pour diagnostiquer un routage qui fonctionne mais renvoie le mauvais service, il faudra passer par le tableau de bord plutôt que par les journaux.

**Pas encore de déploiement par digest.** Le squelette est déployé depuis une étiquette locale `guyana-hello:0.1`, construite sur la machine cible. Le passage au digest attesté suppose une chaîne d'intégration continue et un registre — c'est le §5.6 du plan de déploiement, et cela reste à faire.
