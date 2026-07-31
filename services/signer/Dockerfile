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

COPY services/signer/*.mjs ./
# Les chemins relatifs des imports (`../../site/assets/js/...`) sont préservés :
# c'est ce qui garantit que le fichier chargé ici est bien celui du dépôt.
COPY site/assets/js/canonical.js site/assets/js/multibase.js \
     site/assets/js/keys.js site/assets/js/credential.js \
     site/assets/js/engine.js /site/assets/js/
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
