#!/usr/bin/env bash
# Un worktree par branche (#126).
#
# Le worktree principal reste sur main ; chaque branche vit sous .worktrees/.
# Les chemins non suivis listés dans tools/worktree.links y sont liés depuis
# l'arbre principal. Contrat et garde-fous :
# .claude/skills/software-configuration-management/references/implementation-planning.md
#
# Codes de sortie : 0 succès ; 1 contrôle échoué ou erreur git ; 2 usage ;
# 3 refus de sécurité.
set -uo pipefail

readonly E_FAIL=1 E_USAGE=2 E_REFUSED=3
readonly TYPES="feature bug test doc"
SELF=$(realpath "${BASH_SOURCE[0]}")
readonly SELF

say() { printf 'worktree: %s\n' "$*" >&2; }
die() { local code=$1; shift; say "$@"; exit "$code"; }
usage() {
  die "$E_USAGE" "usage : worktree.sh new <type> <numéro> <description> [base]
       worktree.sh link | check | reclaim
       worktree.sh drop <numéro>-<description>"
}

toplevel() {
  git rev-parse --show-toplevel 2>/dev/null || die "$E_FAIL" "pas dans un dépôt git"
}

# « main » ou « linked ». Deux tests internes à git, jamais un chemin : les liens
# symboliques font mentir les chemins. S'ils ne concordent pas, on s'arrête.
checkout_kind() {
  local top gitdir common dotgit
  top=$(toplevel) || exit
  gitdir=$(cd "$top" && realpath "$(git rev-parse --git-dir)") || die "$E_FAIL" "git rev-parse a échoué"
  common=$(cd "$top" && realpath "$(git rev-parse --git-common-dir)") || die "$E_FAIL" "git rev-parse a échoué"
  if [[ -f $top/.git ]]; then dotgit=fichier
  elif [[ -d $top/.git ]]; then dotgit=répertoire
  else dotgit=absent
  fi
  if [[ $gitdir != "$common" && $dotgit == fichier ]]; then
    echo linked
  elif [[ $gitdir == "$common" && $dotgit == répertoire ]]; then
    echo main
  else
    die "$E_REFUSED" "détection incohérente (git-dir $gitdir, common-dir $common, .git $dotgit) — arrêt"
  fi
}

# Racine de l'arbre principal : le parent du répertoire git commun.
main_root() {
  local common
  common=$(git rev-parse --git-common-dir) || die "$E_FAIL" "git rev-parse a échoué"
  dirname "$(realpath "$common")"
}

# Chemins à lier, lus dans le checkout donné : un par ligne, sans commentaire
# ni barre finale.
link_list() {
  local file=$1/tools/worktree.links line
  [[ -f $file ]] || die "$E_FAIL" "liste absente : $file"
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%%#*}
    line=$(sed 's/^[[:space:]]*//; s/[[:space:]]*$//' <<< "$line")
    line=${line%/}
    [[ -n $line ]] && printf '%s\n' "$line"
  done < "$file"
}

safe_path() { [[ $1 != /* && /$1/ != */../* ]]; }

same_target() { [[ $(realpath -q -- "$1") == "$(realpath -- "$2")" ]]; }

cmd_link() {
  local kind top root list p target here rel
  local -a paths=()
  kind=$(checkout_kind) || exit
  [[ $kind == linked ]] || die "$E_REFUSED" "link refuse l'arbre principal : il y remplacerait des données par des liens"
  top=$(toplevel) || exit
  root=$(main_root) || exit
  list=$(link_list "$top") || exit
  [[ -n $list ]] && mapfile -t paths <<< "$list"

  # Tout valider avant d'écrire quoi que ce soit.
  for p in "${paths[@]}"; do
    safe_path "$p" || die "$E_REFUSED" "chemin refusé : $p"
    git -C "$top" check-ignore -q -- "$p"
    case $? in
      0) ;;
      1) die "$E_REFUSED" "$p n'est pas ignoré par git en tant que lien : écrire « /$p » dans .gitignore, sans barre finale" ;;
      *) die "$E_FAIL" "git check-ignore a échoué sur $p" ;;
    esac
    if [[ -e $top/$p && ! -L $top/$p ]]; then
      die "$E_REFUSED" "$p existe dans le worktree et n'est pas un lien : rien n'est écrasé"
    fi
  done

  for p in "${paths[@]}"; do
    target=$root/$p
    here=$top/$p
    if [[ ! -e $target ]]; then
      say "cible absente de l'arbre principal, ignorée : $p"
      continue
    fi
    if [[ -L $here ]]; then
      same_target "$here" "$target" && continue
      rm -- "$here" || die "$E_FAIL" "impossible de retirer le lien cassé : $p"
    fi
    mkdir -p -- "$(dirname -- "$here")" || die "$E_FAIL" "répertoire impossible pour $p"
    rel=$(realpath --relative-to="$(realpath -- "$(dirname -- "$here")")" -- "$(realpath -- "$target")") ||
      die "$E_FAIL" "chemin relatif impossible pour $p"
    ln -s -- "$rel" "$here" || die "$E_FAIL" "lien impossible : $p"
    say "lié : $p"
  done
}

cmd_check() {
  local kind top root list p target here bad=0
  local -a paths=()
  kind=$(checkout_kind) || exit
  if [[ $kind == main ]]; then
    say "arbre principal : aucun lien à vérifier"
    return 0
  fi
  top=$(toplevel) || exit
  root=$(main_root) || exit
  list=$(link_list "$top") || exit
  [[ -n $list ]] && mapfile -t paths <<< "$list"
  for p in "${paths[@]}"; do
    target=$root/$p
    here=$top/$p
    if [[ ! -e $target ]]; then
      say "cible absente de l'arbre principal : $p"
    elif ! git -C "$top" check-ignore -q -- "$p"; then
      say "non ignoré par git : $p"; bad=1
    elif [[ ! -L $here ]]; then
      say "lien manquant : $p"; bad=1
    elif ! same_target "$here" "$target"; then
      say "lien cassé ou mal dirigé : $p"; bad=1
    fi
  done
  (( bad == 0 )) || exit "$E_FAIL"
  say "liens sains"
}

cmd_new() {
  (( $# == 3 || $# == 4 )) || usage
  local type=$1 num=$2 slug=$3 base=${4:-origin/main} root name dir branch
  [[ " $TYPES " == *" $type "* ]] || die "$E_USAGE" "type inconnu : $type (attendu : $TYPES)"
  [[ $num =~ ^[0-9]+$ ]] || die "$E_USAGE" "numéro invalide : $num"
  [[ $slug =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "$E_USAGE" "description invalide : $slug (minuscules, chiffres, tirets)"
  root=$(main_root) || exit
  name=$num-$slug
  dir=$root/.worktrees/$name
  branch=$type/$name
  [[ -e $dir ]] && die "$E_REFUSED" "le worktree existe déjà : $dir"
  mkdir -p -- "$root/.worktrees" || die "$E_FAIL" "impossible de créer $root/.worktrees"
  git -C "$root" check-ignore -q -- ".worktrees/$name" ||
    die "$E_REFUSED" ".worktrees/ n'est pas ignoré par git dans l'arbre principal"
  if git -C "$root" remote get-url origin >/dev/null 2>&1; then
    git -C "$root" fetch -q origin || die "$E_FAIL" "git fetch origin a échoué"
  fi
  git -C "$root" worktree add -q --no-track -b "$branch" "$dir" "$base" ||
    die "$E_FAIL" "git worktree add a échoué"
  say "créé : $dir, branche $branch"
  (cd "$dir" && "$SELF" link)
}

cmd_reclaim() {
  local kind branch remote merge
  kind=$(checkout_kind) || exit
  [[ $kind == main ]] || die "$E_REFUSED" "reclaim ne s'exécute que dans l'arbre principal"
  if ! branch=$(git symbolic-ref --short -q HEAD); then
    say "tête détachée : rien à faire"; return 0
  fi
  if [[ $branch == main ]]; then
    say "déjà sur main"; return 0
  fi
  # La configuration, pas @{u} : quand l'amont a disparu, @{u} échoue.
  if ! remote=$(git config --get "branch.$branch.remote") ||
     ! merge=$(git config --get "branch.$branch.merge"); then
    say "$branch n'a pas d'amont : le worktree principal reste dessus"; return 0
  fi
  git fetch -q --prune "$remote" || die "$E_FAIL" "git fetch $remote a échoué"
  if git show-ref --verify -q "refs/remotes/$remote/${merge#refs/heads/}"; then
    say "$branch existe encore sur $remote : le worktree principal reste dessus"; return 0
  fi
  [[ -z $(git status --porcelain) ]] ||
    die "$E_REFUSED" "l'arbre principal porte des modifications : $branch n'est pas quittée"
  git switch -q main || die "$E_FAIL" "git switch main a échoué"
  if git show-ref --verify -q "refs/remotes/$remote/main"; then
    git merge -q --ff-only "$remote/main" || die "$E_FAIL" "main ne peut pas avancer en avance rapide"
  fi
  say "$branch a disparu de $remote : retour sur main"
}

cmd_drop() {
  (( $# == 1 )) || usage
  local name=$1 root dir top list p
  local -a paths=()
  [[ $name =~ ^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "$E_USAGE" "nom invalide : $name"
  root=$(main_root) || exit
  dir=$root/.worktrees/$name
  [[ -d $dir ]] || die "$E_FAIL" "worktree introuvable : $dir"
  top=$(toplevel) || exit
  [[ $(realpath -- "$top") == "$(realpath -- "$dir")" ]] &&
    die "$E_REFUSED" "drop ne supprime pas le worktree où il s'exécute"
  [[ -z $(git -C "$dir" status --porcelain) ]] ||
    die "$E_REFUSED" "$name porte des modifications : rien n'est supprimé"
  # Les liens d'abord, et eux seuls : leurs cibles vivent dans l'arbre principal.
  list=$(link_list "$dir" 2>/dev/null) || list=
  [[ -n $list ]] && mapfile -t paths <<< "$list"
  for p in "${paths[@]}"; do
    if [[ -L $dir/$p ]]; then rm -- "$dir/$p"; fi
  done
  git -C "$root" worktree remove "$dir" || die "$E_FAIL" "git worktree remove a échoué"
  git -C "$root" worktree prune
  say "supprimé : $name"
}

dispatch() {
  (( $# >= 1 )) || usage
  local cmd=$1
  shift
  case $cmd in
    new)     cmd_new "$@" ;;
    link)    (( $# == 0 )) || usage; cmd_link ;;
    check)   (( $# == 0 )) || usage; cmd_check ;;
    reclaim) (( $# == 0 )) || usage; cmd_reclaim ;;
    drop)    cmd_drop "$@" ;;
    *)       usage ;;
  esac
}

dispatch "$@"
