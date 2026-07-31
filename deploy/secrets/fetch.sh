#!/usr/bin/env bash
# deploy/secrets/fetch.sh — adaptateur unique vers la source de secrets.
#
# ÉTAT : bouchon. Le squelette n'a aucun secret, ce qui est un fait et non un
# oubli : une page statique publique derrière un certificat déjà provisionné
# n'en demande aucun. Le fichier existe malgré tout, avec son interface
# définitive, pour que les steps ultérieurs n'aient pas à changer de forme.
#
# La décision « où vivent les secrets » (SOPS+age, Vault/OpenBao, secrets
# d'orchestrateur) reste ouverte — voir §7 du plan de déploiement. Elle ne
# bloque pas le squelette.
#
# Interface définitive :
#   secrets/fetch.sh <nom-logique>          -> valeur sur stdout
#   secrets/fetch.sh --ephemeral <nom>      -> valeur jetable, pour la CI
#   secrets/fetch.sh --list                 -> noms logiques connus, un par ligne
#
# Règle : un secret ne transite que par stdout et n'est jamais écrit sur disque,
# ni localement ni sur la cible.

set -euo pipefail

sec_die() { printf '[ERREUR] %s\n' "$*" >&2; exit 1; }

# Où vivent les secrets aujourd'hui : un répertoire local, hors du dépôt.
# La décision SOPS/coffre reste ouverte ; quand elle sera prise, seule cette
# fonction change.
SEC_DIR="${SEC_DIR:-${BASH_SOURCE%/*}/local}"

sec_read() {
  local f="$SEC_DIR/$1"
  [ -r "$f" ] || sec_die "secret absent : $f"
  cat "$f"
}

# Génération locale d'une paire P-256. `openssl` produit le PEM ; la conversion
# en JWK se fait en Python, faute d'un `openssl` qui sache écrire du JWK.
# Les deux formats existent parce que les deux consommateurs diffèrent :
# WebCrypto importe du JWK, `cryptography` lit du PEM.
sec_ensure_ec_pem() {
  local name="$1" pem="$SEC_DIR/$1.pem" pub="$SEC_DIR/$1.pub.jwk"
  [ -s "$pem" ] && [ -s "$pub" ] && return 0
  mkdir -p "$SEC_DIR"; ( umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$pem" )
  sec_jwk_from_pem "$pem" public > "$pub"
  printf 'clé %s générée (%s)\n' "$name" "$pem" >&2
}

sec_ensure_ec_jwk() {
  local name="$1" jwk="$SEC_DIR/$1.jwk" pem="$SEC_DIR/$1.pem"
  [ -s "$jwk" ] && return 0
  mkdir -p "$SEC_DIR"; ( umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$pem" )
  ( umask 077; sec_jwk_from_pem "$pem" private > "$jwk" )
  printf 'clé %s générée (%s)\n' "$name" "$jwk" >&2
}

sec_jwk_from_pem() {
  python3 - "$1" "$2" <<'PYJWK'
import base64, json, sys
from cryptography.hazmat.primitives import serialization

key = serialization.load_pem_private_key(open(sys.argv[1], 'rb').read(), password=None)
n = key.public_key().public_numbers()
b64 = lambda v: base64.urlsafe_b64encode(v.to_bytes(32, 'big')).decode().rstrip('=')
jwk = {"kty": "EC", "crv": "P-256", "x": b64(n.x), "y": b64(n.y)}
if sys.argv[2] == 'private':
    jwk["d"] = b64(key.private_numbers().private_value)
print(json.dumps(jwk))
PYJWK
}

case "${1-}" in
  --list)
    echo basicauth
    echo signer_key
    echo store_key
    echo store_pubkey
    echo db_password
    ;;
  basicauth)
    # Fichier htpasswd : lignes utilisateur:empreinte, jamais de mot de passe.
    sec_read htpasswd
    ;;

  # Trois clés, et leur répartition EST l'invariant : celle qui atteste vit dans
  # le signataire, celle qui authentifie les extractions vit dans le magasin, et
  # le signataire ne reçoit de cette dernière que la partie publique. Distribuer
  # autrement — un secret partagé, une clé unique — remettrait un pouvoir de
  # signer dans le processus qui détient les données.
  #
  # Générées à la demande et conservées localement. Une rotation les régénère ;
  # le jour où l'adaptateur parlera à un coffre, seul ce fichier change.
  signer_key)
    sec_ensure_ec_jwk signer_key
    sec_read signer_key.jwk
    ;;
  store_key)
    sec_ensure_ec_pem store_key
    sec_read store_key.pem
    ;;
  store_pubkey)
    sec_ensure_ec_pem store_key
    sec_read store_key.pub.jwk
    ;;

  # Persisté, et non éphémère : POSTGRES_PASSWORD ne s'applique qu'à
  # l'initialisation. Un mot de passe régénéré à chaque déploiement laisserait
  # une base déjà initialisée refuser la connexion, et le diagnostic porterait
  # sur le magasin.
  db_password)
    if [ ! -s "$SEC_DIR/db_password" ]; then
      mkdir -p "$SEC_DIR"
      ( umask 077; head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$SEC_DIR/db_password" )
      printf 'mot de passe de base généré (%s)\n' "$SEC_DIR/db_password" >&2
    fi
    sec_read db_password
    ;;
  --ephemeral)
    [ $# -ge 2 ] || sec_die "--ephemeral exige un nom logique"
    # Valeur jetable pour le job ephemeral : jamais réutilisée, jamais persistée.
    head -c 32 /dev/urandom | base64 | tr -d '\n='
    ;;
  '')
    sec_die "usage: fetch.sh [--ephemeral|--list] <nom-logique>"
    ;;
  *)
    sec_die "unknown secret: '$1'. Declare it in --list before requesting it."
    ;;
esac
