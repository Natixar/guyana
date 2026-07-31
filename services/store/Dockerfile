# Le magasin. La base, et aucune clé d'attestation.
#
# Il signe ses extractions — « ces enregistrements viennent de moi » — mais
# jamais une attestation carbone. La clé qui atteste vit dans le signataire, et
# les deux ne se rencontrent pas.
#
#   docker build -f services/store/Dockerfile services/store
FROM python:3.12-slim

WORKDIR /app

# Dépendances d'abord : la couche ne se reconstruit que si le manifeste change.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py schema.sql ./

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    STORE_PORT=8082

# Aucun port publié : Traefik joint le conteneur par son nom sur le réseau proxy,
# et PostgreSQL n'est joignable que sur le réseau de données.
EXPOSE 8082

# Pas root. Le processus qui détient la base n'a aucune raison de pouvoir
# écrire ailleurs que là où il lit.
RUN useradd --create-home --uid 10001 store
USER store

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${STORE_PORT}"]
