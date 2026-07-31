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

case "${1-}" in
  --list)
    echo basicauth
    ;;
  basicauth)
    # Fichier htpasswd : lignes utilisateur:empreinte, jamais de mot de passe.
    sec_read htpasswd
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
