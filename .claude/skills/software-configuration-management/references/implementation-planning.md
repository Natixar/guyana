# Implementation Planning

**Precondition**: Task 2 (Shared Issue Understanding) completed with explicit reviewer approval. Do not proceed without approval.

This segment covers branch creation and detailed planning.

## Step 2: Branch and Worktree Creation
- **Objective**: Create an isolated workspace for the approved work, without touching the main worktree.
- **Activities**:
  - Choose the branch name `{type}/{number}-{short-description}`, where {type} is:
    - `feature` for new features
    - `bug` for bugs (actual behavior different from documented or desirable behavior, or documentation error, or skill/process description error)
    - `test` for issues requiring additional tests, but failing tests must be labelled `bug` if they should pass and the error appears to be in the test rather than the library
    - `doc` for issues involving only documentation but not errors (e.g., translations, etc.)
  - From the main worktree, run `tools/worktree.sh new {type} {number} {short-description}`. It fetches `origin`, creates the branch from `origin/main`, creates the worktree `.worktrees/{number}-{short-description}`, and links the untracked paths listed in `tools/worktree.links`.
  - **Work only inside that worktree from now on.** Never switch the branch of the main worktree: that is the maintainer's prerogative.
  - From the worktree, push the branch with its upstream (`git push -u origin HEAD`).
- **The script's contract** (`tools/worktree.sh`, tested by `tools/worktree.bats`):

  | Command | Effect |
  |---|---|
  | `new {type} {number} {short-description} [base]` | branch + worktree under `.worktrees/`, links posed; `base` defaults to `origin/main` |
  | `link` | creates or repairs the links of the current worktree; idempotent |
  | `check` | verifies the links; changes nothing; exits non-zero on a missing or broken link |
  | `reclaim` | in the main worktree only: if the current branch has disappeared from `origin` and the tree is clean, switches back to `main` and fast-forwards it |
  | `drop {number}-{short-description}` | removes a clean worktree and prunes; never deletes a link target |

  - **Exit status**: `0` success; `1` a check failed or git failed; `2` usage error; `3` refused for safety. Safety refusals are tested on code `3`, so that a missing script (exit `127`) can never pass them.
  - **Detection never trusts paths**, which symbolic links falsify. A worktree is linked when `git rev-parse --git-dir` differs from `--git-common-dir` (compared after `realpath`) **and** its `.git` is a file rather than a directory. If the two tests disagree, the script stops.
  - **`link` refuses the main worktree**, never overwrites a real directory, and refuses any path that git does not ignore *as a link*: the matching `.gitignore` entry must be anchored and have no trailing slash (`/poc-data`, not `poc-data/`), because git treats a symbolic link as a file.
- **Validation**: The branch exists and is pushed, its worktree exists under `.worktrees/`, and `tools/worktree.sh check` passes inside it.

## Step 3: Implementation Planning
- **Objective**: Turn the assessment into a practical plan.
- **Activities**:
  - Confirm the new branch is sane and references the approved issue.
  - Break down the work into specific tasks, identify files/components to change, and roughly describe their interactions.
  - Plan the testing strategy (unit/integration/manual) without repeating the high-level blocker list from Step 1 (since we assume no major blockers remain after Step 1 approval).
  - Update the issue with the plan and note any tooling or skill dependencies.
  - Review reviewer comments and consider their implications for the plan.
- **Validation**: The plan is comprehensive and recorded in the issue using markdown, and the branch and files are scoped accordingly and the human reviewer has approved the work.