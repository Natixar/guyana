# Integration

**Precondition**: Task 5 (Implementation) completed with maintainer review approval. Do not proceed without review approval.

This segment covers final integration and post-implementation validation.

## Step 8: Final Integration
- **Objective**: Let GitHub integrate the approved change after all protections pass.
- **Activities**:
  - **Remove review scaffolding.** Delete any `REVIEW PLACEHOLDER` comments left in tests to map removed/replaced tests during review (see `test-driven-development.md`), now that the maintainer has approved. The final merged history must not carry them.
  - Ensure CI/CD checks are green.
  - Confirm the PR satisfies branch protection requirements.
  - Allow GitHub to auto-merge once everything is ready (manual merging is not required). GitHub will squash all the commits in one.
  - Update dependent issues or TODOs if applicable.
  - After GitHub merges and deletes the remote branch, from the main worktree:
    1. `git fetch --prune origin`;
    2. `tools/worktree.sh reclaim` — brings the main worktree back to `main` if the maintainer had left it on the merged branch, and does nothing otherwise;
    3. `tools/worktree.sh drop {number}-{short-description}` — removes the branch worktree;
    4. delete the local branch (`git branch -D`), since a squash merge leaves it unmerged in git's eyes.
  - If the PR addressed multiple issues, manually close any additional referenced issues after confirming tests pass (GitHub closes at most one issue per PR).
- **Validation**: The change merges automatically after meeting the protected branch checks, and local repo is synchronized.

## Step 9: Post-Implementation Validation
- **Objective**: Confirm the change stabilizes in the repository.
- **Activities**:
  - Monitor for regressions or failures triggered by the merge.
  - Confirm that change history entries are present and accurate in all files modified by the PR, and that `history.md` files are present in all skill directories touched by the PR.
  - Update release notes or communication channels if required.
  - Confirm that `git worktree list` no longer shows the branch worktree and that the main worktree is on `main`.
- **Completion**: Issue is marked resolved and all follow-ups addressed.
- **Note**: GitHub will automatically close the associated issue and may delete the branch upon successful merge. The remaining actions are local: return the main worktree to `main` if needed, drop the branch worktree, and synchronize.