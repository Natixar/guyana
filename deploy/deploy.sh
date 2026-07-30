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
# DOCTRINE — commune aux trois vagues d'automatisation : un script accompagne
# son utilisateur. Il gère l'agent SSH, il dit ce qu'il va faire avant de le
# faire, et quand il échoue il donne la commande qui répare. Un script correct
# mais taciturne n'est pas conforme.
#
#   ./deploy/deploy.sh --env kubb                # simulation, avec aperçu
#   ./deploy/deploy.sh --env kubb --apply        # exécution, après confirmation
#   ./deploy/deploy.sh --env kubb --apply --yes  # sans confirmation
#   ./deploy/deploy.sh --env kubb --teardown

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "$HERE/.." && pwd)"
ENV_NAME="" ; APPLY=0 ; TEARDOWN=0 ; ASSUME_YES=0
AGENT_TTL="${DEPLOY_AGENT_TTL:-3600}"   # expiration de l'agent SSH, en secondes

# --- présentation ----------------------------------------------------------
if [ -t 1 ]; then
    C_TITLE=$'\e[1m'; C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_OFF=$'\e[0m'
else
    C_TITLE=''; C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''
fi
say()   { printf '%s\n' "$*"; }
title() { printf '\n%s%s%s\n' "$C_TITLE" "$*" "$C_OFF"; }
ok()    { printf '  %sok%s    %s\n' "$C_OK" "$C_OFF" "$*"; }
warn()  { printf '  %sattention%s %s\n' "$C_WARN" "$C_OFF" "$*"; }

# Un échec explique toujours comment le réparer.
die() { # $1 = diagnostic, $2.. = lignes de remédiation
    printf '\n%s[ÉCHEC]%s %s\n' "$C_ERR" "$C_OFF" "$1" >&2
    shift
    if [ $# -gt 0 ]; then
        printf '\n  Pour corriger :\n' >&2
        printf '    %s\n' "$@" >&2
    fi
    printf '\n' >&2
    exit 1
}

# --- options ---------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        --env)      ENV_NAME="${2:?--env exige un nom}"; shift 2 ;;
        --apply)    APPLY=1; shift ;;
        --teardown) TEARDOWN=1; shift ;;
        --yes|-y)   ASSUME_YES=1; shift ;;
        -h|--help)  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)          die "option inconnue : $1" "$0 --help" ;;
    esac
done

if [ -z "$ENV_NAME" ]; then
    avail=$(ls -1 "$HERE"/inventory/hosts.d/*.env 2>/dev/null \
            | xargs -r -n1 basename | sed 's/\.env$//' | tr '\n' ' ')
    die "--env est obligatoire." "environnements disponibles : ${avail:-aucun}" \
        "$0 --env <nom>"
fi

ENV_FILE="$HERE/inventory/hosts.d/${ENV_NAME}.env"
[ -f "$ENV_FILE" ] || die "descripteur introuvable : $ENV_FILE" \
    "vérifiez le nom, ou créez le descripteur en copiant un existant"
# shellcheck source=/dev/null
. "$ENV_FILE"

APP_CONTAINER="${ROUTER_PREFIX}-hello"
COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo inconnu)"
SHORT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo dev)"
APP_IMAGE="${ROUTER_PREFIX}-hello:${SHORT}"
DIRTY=""
git -C "$REPO" diff --quiet 2>/dev/null || DIRTY=" (arbre de travail modifié)"

# --- agent SSH : on l'installe pour l'utilisateur plutôt que de s'en plaindre
ensure_agent() {
    title "Agent SSH"

    if [ -n "${SSH_AUTH_SOCK:-}" ] && ssh-add -l >/dev/null 2>&1; then
        ok "agent déjà actif, $(ssh-add -l 2>/dev/null | wc -l) clé(s) chargée(s)"
        return 0
    fi

    if [ -z "${SSH_AUTH_SOCK:-}" ]; then
        say "  aucun agent détecté — j'en démarre un, expiration ${AGENT_TTL}s"
        eval "$(ssh-agent -t "$AGENT_TTL" -s)" >/dev/null
        ok "agent démarré (PID ${SSH_AGENT_PID:-?}), il s'effacera tout seul"
    fi

    if ! ssh-add -l >/dev/null 2>&1; then
        say ""
        say "  Aucune clé n'est chargée. Je vais vous la demander une fois ;"
        say "  elle restera disponible ${AGENT_TTL} secondes, puis sera oubliée."
        say ""
        local key="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
        [ -f "$key" ] || die "clé introuvable : $key" \
            "indiquez-la : DEPLOY_SSH_KEY=/chemin/vers/la/cle $0 --env $ENV_NAME" \
            "ou créez-en une : ssh-keygen -t ed25519 -C '${DEPLOY_USER}@${DEPLOY_HOST}'"
        ssh-add -t "$AGENT_TTL" "$key" \
            || die "la clé n'a pas pu être chargée" "vérifiez la phrase de passe"
        ok "clé chargée"
    fi
}

# --- accès à la cible ------------------------------------------------------
rsh() { ssh $DEPLOY_SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

check_target() {
    title "Accès à ${DEPLOY_USER}@${DEPLOY_HOST}"
    if rsh true 2>/dev/null; then
        ok "connexion établie"
        return 0
    fi
    # Le mode d'échec rencontré le 30/07 : la résolution part sur l'AAAA alors
    # qu'IPv6 a disparu du poste. Le descripteur porte déjà -4 ; si l'on arrive
    # ici malgré tout, c'est autre chose.
    die "impossible de joindre ${DEPLOY_USER}@${DEPLOY_HOST}" \
        "ssh -v $DEPLOY_SSH_OPTS ${DEPLOY_USER}@${DEPLOY_HOST}   # pour voir pourquoi" \
        "getent hosts ${DEPLOY_HOST}                              # la machine résout-elle ?" \
        "si la résolution donne une IPv6 injoignable, DEPLOY_SSH_OPTS contient déjà -4"
}

# --- aperçu : on dit ce qu'on va faire avant de le faire -------------------
preview() {
    title "Ce qui va se passer"
    cat <<APERCU
  environnement   $ENV_NAME
  cible           ${DEPLOY_USER}@${DEPLOY_HOST}
  commit          ${COMMIT:0:12}${DIRTY}
  image           $APP_IMAGE   (construite sur la cible, contexte par stdin)
  conteneur       $APP_CONTAINER   (recréé — les labels ne changent pas à chaud)
  réseau          $PROXY_NETWORK
  domaines        $APP_DOMAINS
  routeurs        ${ROUTER_PREFIX}-r1…  plus  ${ROUTER_PREFIX}-any (priorité 1)

  Ce qui n'est PAS touché :
    la configuration de Traefik, gérée par un autre projet
    $PROXY_NETWORK, qui appartient au projet Compose de Traefik
    les sous-domaines réservés : ${RESERVED_SUBDOMAINS:-—}
    les services opérationnels : ${OPERATIONAL_SERVICES:-—}
APERCU
}

confirm() {
    [ "$ASSUME_YES" -eq 1 ] && return 0
    [ -t 0 ] || die "exécution non interactive sans --yes" "$0 --env $ENV_NAME --apply --yes"
    printf "\n  Confirmer l'exécution sur %s ? [o/N] " "$DEPLOY_HOST"
    local rep; read -r rep
    case "$rep" in [oOyY]*) return 0 ;; *) say "  abandon."; exit 0 ;; esac
}

# --- exécution -------------------------------------------------------------
run_step() { # $1 = fichier de step ; le script voyage par stdin, rien n'est écrit sur la cible
    local step="$1" name; name="$(basename "$step")"
    if [ "$APPLY" -eq 0 ]; then say "  · $name (simulation)"; return 0; fi
    say "  · $name"
    rsh "PROXY_NETWORK='$PROXY_NETWORK' APP_CONTAINER='$APP_CONTAINER' \
         APP_IMAGE='$APP_IMAGE' APP_IMAGE_ID='${APP_IMAGE_ID:-}' \
         APP_DOMAINS='$APP_DOMAINS' ROUTER_PREFIX='$ROUTER_PREFIX' bash -s" < "$step" \
      || die "$name a échoué sur ${DEPLOY_HOST}" \
             "le message ci-dessus vient de la cible" \
             "rien n'a été laissé sur son système de fichiers : les scripts passent par stdin"
}

# ===========================================================================
say ""
say "${C_TITLE}Déploiement Aurora${C_OFF} — $( [ "$APPLY" -eq 1 ] && echo EXÉCUTION || echo simulation )"

ensure_agent
check_target

if [ "$TEARDOWN" -eq 1 ]; then
    title "Retrait"
    confirm
    APPLY=1
    run_step "$HERE/steps/99-teardown.sh"
    say ""; ok "retiré."
    exit 0
fi

preview

if [ -n "$DIRTY" ] && [ "$APPLY" -eq 1 ]; then
    die "l'arbre de travail est modifié : ce qui serait déployé n'est pas ce qui est commité" \
        "git status              # voir ce qui diffère" \
        "git commit -a           # puis relancer" \
        "ou déployez en simulation, sans --apply"
fi

[ "$APPLY" -eq 1 ] && confirm

title "Préparation"
run_step "$HERE/steps/00-preflight.sh"
run_step "$HERE/steps/30-network.sh"

title "Construction"
if [ "$APPLY" -eq 1 ]; then
    APP_IMAGE_ID="$(tar -C "$HERE/skeleton" -cf - . \
        | rsh "docker build -q -t '$APP_IMAGE' -" | tail -1)" \
        || die "la construction de l'image a échoué"
    export APP_IMAGE_ID
    ok "image $APP_IMAGE_ID"
else
    say "  · contexte envoyé par stdin, image construite sur la cible (simulation)"
fi

title "Lancement"
run_step "$HERE/steps/60-app.sh"

if [ "$APPLY" -eq 1 ]; then
    printf '%s\t%s\t%s\t%s\t%s\n' \
        "$(date -u +%FT%TZ)" "$(id -un)@$(hostname)" "$ENV_NAME" "$COMMIT" "${APP_IMAGE_ID:-?}" \
        >> "$HERE/deployments.log"
    title "Terminé"
    ok "consigné dans deploy/deployments.log"
    say ""
    say "  Vérifiez maintenant — c'est la moitié du travail :"
    say "    bats deploy/verify/*.bats"
else
    title "Simulation terminée"
    say "  Rien n'a été modifié. Pour exécuter :"
    say "    $0 --env $ENV_NAME --apply"
fi
say ""
