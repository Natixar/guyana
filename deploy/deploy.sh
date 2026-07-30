#!/usr/bin/env bash
# deploy/deploy.sh — lanceur semi-automatique.
#
# « Semi-automatique » désigne quelque chose de précis : l'humain fournit
# l'intention (quel environnement) et le justificatif d'accès (l'agent SSH).
# Le reste est mécanique. Pas d'accès permanent à la production : l'élévation
# est un acte, et cet acte laisse une trace.
#
# Ce script ne s'exécute JAMAIS depuis un exécuteur GitHub. Voir §5.2 du plan.
#
#   ./deploy/deploy.sh --env kubb            # simulation (défaut)
#   ./deploy/deploy.sh --env kubb --apply    # exécution réelle
#   ./deploy/deploy.sh --env kubb --teardown

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="" ; APPLY=0 ; TEARDOWN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env)      ENV_NAME="${2:?--env exige un nom}"; shift 2 ;;
    --apply)    APPLY=1; shift ;;
    --teardown) TEARDOWN=1; shift ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done
[ -n "$ENV_NAME" ] || { echo "--env est obligatoire" >&2; exit 2; }

ENV_FILE="$HERE/inventory/hosts.d/${ENV_NAME}.env"
[ -f "$ENV_FILE" ] || { echo "descripteur introuvable : $ENV_FILE" >&2; exit 2; }
# shellcheck source=/dev/null
. "$ENV_FILE"

APP_CONTAINER="${ROUTER_PREFIX}-hello"
APP_IMAGE="${ROUTER_PREFIX}-hello:$(git -C "$HERE/.." rev-parse --short HEAD 2>/dev/null || echo dev)"

# --- Provenance : quel commit déployons-nous ? -----------------------------
COMMIT="$(git -C "$HERE/.." rev-parse HEAD 2>/dev/null || echo inconnu)"
DIRTY=""
git -C "$HERE/.." diff --quiet 2>/dev/null || DIRTY=" (arbre modifié)"

cat <<SUMMARY
== déploiement Aurora ==
  environnement : $ENV_NAME
  cible         : ${DEPLOY_USER}@${DEPLOY_HOST}
  commit        : ${COMMIT}${DIRTY}
  image         : $APP_IMAGE
  conteneur     : $APP_CONTAINER
  domaines      : $APP_DOMAINS
  mode          : $([ "$APPLY" -eq 1 ] && echo "EXÉCUTION" || echo "simulation")
SUMMARY

if [ -n "$DIRTY" ] && [ "$APPLY" -eq 1 ]; then
  echo "[ERREUR] arbre de travail modifié : ce qui serait déployé n'est pas ce qui est commité." >&2
  echo "         Commitez, ou déployez en simulation." >&2
  exit 1
fi

# shellcheck disable=SC2029  # l'expansion locale des variables est voulue
rsh() { ssh $DEPLOY_SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

# Les scripts voyagent par stdin : rien n'est écrit sur la cible.
run_step() { # $1 = fichier de step
  local step="$1" name; name="$(basename "$step")"
  echo "-- $name"
  if [ "$APPLY" -eq 0 ]; then echo "   (simulation, non exécuté)"; return 0; fi
  rsh "PROXY_NETWORK='$PROXY_NETWORK' APP_CONTAINER='$APP_CONTAINER' \
       APP_IMAGE='$APP_IMAGE' APP_IMAGE_ID='${APP_IMAGE_ID:-}' \
       APP_DOMAINS='$APP_DOMAINS' ROUTER_PREFIX='$ROUTER_PREFIX' bash -s" < "$step"
}

if [ "$TEARDOWN" -eq 1 ]; then
  run_step "$HERE/steps/99-teardown.sh"; exit 0
fi

run_step "$HERE/steps/00-preflight.sh"
run_step "$HERE/steps/30-network.sh"

# --- Construction : le contexte voyage par stdin ---------------------------
echo "-- construction de l'image"
if [ "$APPLY" -eq 1 ]; then
  APP_IMAGE_ID="$(tar -C "$HERE/skeleton" -cf - . \
    | rsh "docker build -q -t '$APP_IMAGE' -" | tail -1)"
  echo "   $APP_IMAGE_ID"
  export APP_IMAGE_ID
else
  echo "   (simulation, non construite)"
fi

run_step "$HERE/steps/60-app.sh"

# --- Enregistrement de déploiement -----------------------------------------
if [ "$APPLY" -eq 1 ]; then
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%FT%TZ)" "$(id -un)@$(hostname)" "$ENV_NAME" "$COMMIT" "${APP_IMAGE_ID:-?}" \
    >> "$HERE/deployments.log"
  echo "-- enregistré dans deploy/deployments.log"
fi

echo "== terminé =="
