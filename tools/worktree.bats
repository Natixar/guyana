#!/usr/bin/env bats
# Contrat de tools/worktree.sh (#126).
#
# Chaque test monte un dépôt jetable avec son dépôt distant nu : rien ne touche le
# dépôt réel. Le script lit la liste de liens du worktree où il s'exécute.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/worktree.sh"
  TMP="$(mktemp -d)"
  ORIGIN="$TMP/origin.git"
  MAIN="$TMP/main"
  git init -q --bare -b main "$ORIGIN"
  git init -q -b main "$MAIN"
  cd "$MAIN"
  git config user.email test@example.invalid
  git config user.name test
  mkdir tools
  printf 'data\n' > tools/worktree.links
  printf '/data\n/.worktrees/\n' > .gitignore
  git add .gitignore tools/worktree.links
  git commit -qm init
  git remote add origin "$ORIGIN"
  git push -q -u origin main
  mkdir data
  echo secret > data/f
}

teardown() {
  rm -rf "$TMP"
}

# --- new -------------------------------------------------------------------

@test "new crée la branche et son worktree sous .worktrees, liens posés" {
  run "$SCRIPT" new feature 7 essai
  [ "$status" -eq 0 ]
  [ -d .worktrees/7-essai ]
  [ "$(git -C .worktrees/7-essai branch --show-current)" = "feature/7-essai" ]
  [ -L .worktrees/7-essai/data ]
  [ "$(readlink -f .worktrees/7-essai/data)" = "$(readlink -f "$MAIN/data")" ]
}

@test "new laisse un worktree propre : le lien est ignoré par git" {
  "$SCRIPT" new feature 7 essai
  [ -z "$(git -C .worktrees/7-essai status --porcelain)" ]
}

# --- link ------------------------------------------------------------------

@test "link est idempotente dans un worktree" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  run "$SCRIPT" link
  [ "$status" -eq 0 ]
  run "$SCRIPT" link
  [ "$status" -eq 0 ]
  [ "$(readlink -f data)" = "$(readlink -f "$MAIN/data")" ]
}

@test "link répare un lien supprimé" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  rm data
  run "$SCRIPT" link
  [ "$status" -eq 0 ]
  [ -L data ]
}

@test "link refuse l'arbre principal et n'y touche à rien" {
  run "$SCRIPT" link
  [ "$status" -ne 0 ]
  [ -d data ]
  [ ! -L data ]
  [ "$(cat data/f)" = secret ]
}

@test "link refuse l'arbre principal même atteint par un lien symbolique" {
  ln -s "$MAIN" "$TMP/alias-main"
  cd "$TMP/alias-main"
  run "$SCRIPT" link
  [ "$status" -ne 0 ]
  [ ! -L "$MAIN/data" ]
}

@test "link reconnaît un worktree atteint par un lien symbolique" {
  "$SCRIPT" new feature 7 essai
  ln -s "$MAIN/.worktrees/7-essai" "$TMP/alias-wt"
  cd "$TMP/alias-wt"
  run "$SCRIPT" link
  [ "$status" -eq 0 ]
}

@test "link n'écrase jamais un vrai répertoire" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  rm data
  mkdir data
  echo local > data/g
  run "$SCRIPT" link
  [ "$status" -ne 0 ]
  [ ! -L data ]
  [ "$(cat data/g)" = local ]
}

@test "link refuse un chemin que git n'ignore pas" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  printf 'data\nsuivi\n' > tools/worktree.links
  mkdir "$MAIN/suivi"
  run "$SCRIPT" link
  [ "$status" -ne 0 ]
  [ ! -e suivi ]
}

@test "link refuse un motif à barre finale, qui n'ignore pas un lien" {
  printf 'data/\n/.worktrees/\n' > .gitignore
  git commit -qam "motif à barre finale"
  git push -q
  run "$SCRIPT" new feature 7 essai
  [ "$status" -ne 0 ]
  [ ! -L .worktrees/7-essai/data ]
}

# --- check -----------------------------------------------------------------

@test "check réussit sur des liens sains et échoue sur un lien cassé" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  run "$SCRIPT" check
  [ "$status" -eq 0 ]
  rm data
  ln -s "$TMP/nulle-part" data
  run "$SCRIPT" check
  [ "$status" -ne 0 ]
}

@test "check ne modifie rien" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  rm data
  run "$SCRIPT" check
  [ "$status" -ne 0 ]
  [ ! -e data ]
}

# --- reclaim ---------------------------------------------------------------

@test "reclaim ramène l'arbre principal sur main quand sa branche a disparu du distant" {
  git switch -q -c feature/8-fusionnee
  git commit -q --allow-empty -m travail
  git push -q -u origin feature/8-fusionnee
  git push -q origin --delete feature/8-fusionnee
  run "$SCRIPT" reclaim
  [ "$status" -eq 0 ]
  [ "$(git branch --show-current)" = main ]
}

@test "reclaim laisse une branche encore présente sur le distant" {
  git switch -q -c feature/9-en-cours
  git push -q -u origin feature/9-en-cours
  run "$SCRIPT" reclaim
  [ "$status" -eq 0 ]
  [ "$(git branch --show-current)" = feature/9-en-cours ]
}

@test "reclaim refuse de basculer un arbre principal modifié" {
  git switch -q -c feature/8-fusionnee
  git push -q -u origin feature/8-fusionnee
  git push -q origin --delete feature/8-fusionnee
  echo modification >> .gitignore
  run "$SCRIPT" reclaim
  [ "$status" -ne 0 ]
  [ "$(git branch --show-current)" = feature/8-fusionnee ]
}

@test "reclaim refuse de s'exécuter dans un worktree lié" {
  "$SCRIPT" new feature 7 essai
  cd .worktrees/7-essai
  run "$SCRIPT" reclaim
  [ "$status" -ne 0 ]
}

# --- drop ------------------------------------------------------------------

@test "drop supprime un worktree propre et élague" {
  "$SCRIPT" new feature 7 essai
  run "$SCRIPT" drop 7-essai
  [ "$status" -eq 0 ]
  [ ! -e .worktrees/7-essai ]
  ! git worktree list | grep -q 7-essai
}

@test "drop refuse un worktree qui porte des modifications" {
  "$SCRIPT" new feature 7 essai
  echo x > .worktrees/7-essai/nouveau.txt
  run "$SCRIPT" drop 7-essai
  [ "$status" -ne 0 ]
  [ -d .worktrees/7-essai ]
}

@test "drop n'efface jamais la cible d'un lien" {
  "$SCRIPT" new feature 7 essai
  "$SCRIPT" drop 7-essai
  [ "$(cat "$MAIN/data/f")" = secret ]
}
