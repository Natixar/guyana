# Le signataire. Une clé, aucune base.
#
# Le contexte de construction est la RACINE du dépôt, pas ce répertoire :
# l'image doit embarquer le moteur et la chaîne cryptographique de `site/`,
# c'est-à-dire les fichiers source mêmes que la page importe. Copier une variante
# d'ici romprait « un moteur, deux hôtes » sans que rien ne le signale.
#
#   docker build -f services/signer/Dockerfile .
FROM node:22-alpine

WORKDIR /app

# Dépendances d'abord : la couche ne se reconstruit que si le manifeste change.
COPY services/signer/package.json services/signer/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev --no-audit --no-fund

# Les fichiers de test voyagent avec le reste, délibérément : une image qu'on
# peut interroger — `node --test '/app/*.test.mjs'` — se vérifie après coup,
# y compris sur la cible. Quelques kilo-octets qui ne s'exécutent jamais seuls.
COPY services/signer/*.mjs ./

# LE RÉPERTOIRE ENTIER, PAS UNE LISTE. Une liste explicite paraît plus propre et
# se casse en silence : le jour où un module gagne une dépendance, l'image perd
# un fichier et le service redémarre en boucle sur ERR_MODULE_NOT_FOUND. C'est
# arrivé — `keys.js` a commencé à importer `idb.js`, absent de la liste.
#
# Les modules purement navigateur embarqués au passage ne coûtent que quelques
# kilo-octets et ne sont jamais chargés. Les chemins relatifs des imports
# (`../../site/assets/js/...`) sont préservés : c'est ce qui garantit que le
# fichier exécuté ici est bien celui du dépôt.
COPY site/assets/js/ /site/assets/js/
# La taxonomie et les vecteurs à leur place du dépôt, pour que les chemins
# relatifs valent ici comme là-bas. La copie dans /app est celle que le service
# lit au démarrage ; celle sous /site est celle que les tests et les vecteurs
# partagés attendent — même fichier, deux consommateurs.
COPY site/static/engine/ /site/static/engine/
COPY site/static/engine/taxonomy.json /app/taxonomy.json

# `../../site/...` depuis /app/server.mjs se résout en /site/... : la racine
# absorbe le remontage excédentaire. L'arborescence est donc alignée sans
# réécrire un seul chemin d'import, ce qui est la condition pour que le fichier
# chargé ici soit identique à celui que la page importe.

ENV NODE_ENV=production \
    SIGNER_PORT=8081 \
    TAXONOMY_PATH=/app/taxonomy.json

# Aucun port publié : Traefik joint le conteneur par son nom sur le réseau proxy.
EXPOSE 8081

# Pas root. Le processus qui détient la clé de signature n'a aucune raison de
# pouvoir écrire ailleurs que là où il lit.
USER node

CMD ["node", "server.mjs"]
