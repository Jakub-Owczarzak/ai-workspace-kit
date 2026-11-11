# Factory host interface

What the factory needs from a code host, and how each host does it. The `run-factory` skill is written against the
operations in this table, not against `gh` or `glab`: each host has a reference file next to the skill
(`skills/run-factory/references/github.md`, `gitlab.md`), so a new host means one new column here and one new file
there. Commands marked **proven** were run in the spike (`factory-spike.md`) or the rehearsals
(`factory-rehearsal.md`); **not run** means taken from the tool's help or documentation and not tried.

Rules that hold on every host:

- The factory runs **inside the project's own clone**. `glab mr create` reads the git remotes of the current
  folder, and `-R <project>` did not override that.
- The user signs in to the host. The kit never stores, asks for or prints a token.
- The factory never creates or deletes a repository or a project (`gh repo delete` needs a token scope the factory
  should not ask for).
- Nothing is merged or deployed. There is no merge operation in this interface on purpose.
- A step that fails stops the factory with a report: what ran, the real output, what was not done.

| # | Operation | GitHub (`gh`) | GitLab (`glab`) |
|---|---|---|---|
| 1 | Detect the host | `git remote get-url origin` contains `github.com`; any other host name needs `factory.host` | `git remote get-url origin` contains `gitlab.com`; a self-managed host needs `factory.host` |
| 2 | Tool and login present | `gh auth status` (**proven**) | `glab auth status --hostname gitlab.com` (**proven**; prints the account, never the token) |
| 3 | Stacking available | `gh extension list` shows `gh stack` (**proven**, v0.3.0; the extension is a preview feature, so keep the fallback) | None. GitLab has no stack object; a chain of merge requests is the stack |
| 4 | Push a branch | `git push origin <branch>` (**proven**) | `git push origin <branch>` (**proven**) |
| 5 | Open one change | `gh pr create --base <b> --head <h> --title <t> --body-file <f>` (**not run**; `gh pr edit` was proven) | `glab mr create --source-branch <h> --target-branch <b> --title <t> --description <d> --yes` (**proven**; `--description-file <f>` also exists on create and update) |
| 6 | Open a stack | `gh stack init <layer-1>`, `gh stack add -Am "<msg>" <layer-n>`, `gh stack submit --auto --open` (**proven**) | One `glab mr create` per layer, each targeting the branch of the layer below (**proven**: MR 2 targeted `layer-1`) |
| 7 | Set the description | `gh pr edit <n> --body-file <f>` (**proven**); find `<n>` with `gh pr list --head <branch> --json number --jq '.[0].number'` (**proven**). `gh stack submit --auto` cannot set a body, so this follows it | `glab mr update <branch> --description-file <f>` (**proven**); find the MR with `glab mr view <branch> -F json` and read `iid` (**proven**) |
| 8 | Show a screenshot | `node scripts/e2e-shots.mjs publish --dir <folder> --subdir <name>` puts the PNGs on a separate `factory-screenshots` branch (an orphan commit, so `main` and the feature branch never hold them) and prints Markdown that links each image by **commit SHA**: `https://github.com/<o>/<r>/blob/<sha>/<path>?raw=true`. **Proven:** a real publish, the image fetched back through the API at the same size, the repo left untouched, and GitHub's rendered HTML holds the `<img>`. **Not seen** in a logged-in browser | The same script builds `https://gitlab.com/<ns>/<proj>/-/raw/<sha>/<path>`. **Proven:** a real publish; the file at that commit fetched through the API at the same size; an orphan commit; the MR's `description_html` (`?render_html=true`) holds an `<img>` per image, lazy-loaded through `data-src`. **Not seen** in a logged-in browser |
| 9 | Wait for CI | `gh pr checks <n> --watch --interval 5` blocks until done; exit 0 passed, 1 failed (**proven**) | `glab ci status --wait --compact -b <branch>`; exit 0 when it passed and 1 when it failed (**proven**; `-b` needs no branch switch) |
| 10 | Read why CI failed | `gh run view <run-id> --log-failed` (**proven**; the run id is in the check URL from step 9) | `glab ci trace <job name> -b <branch>` (**proven**; 100 raw lines), through `node scripts/factory-guard.mjs clean-log` (the same cleaner as for GitHub), or `glab api projects/<id>/jobs/<job-id>/trace` (**proven** in the spike) |
| 11 | Push a fix | `gh stack push` for a stack, `git push` for one branch (**proven**) | `git push origin <branch>` (**proven**) |
| 12 | Keep the stack current | `gh stack sync` (**proven** when nothing moved; a rebase after `main` moved is **not run**). After a fix on a lower layer: `gh stack rebase --upstack` from that layer, then `gh stack push` (**proven** in the rehearsal: the layer above was rebased onto the new tip and pushed without a manual force) | By hand, no force-push: for each upper branch, bottom to top, `git merge --no-edit <branch below>` then `git push` (**proven**: the fix reached the upper layer and both pipelines went green). With `review.mode` `required` the merge result needs a review record before the push (**not run**) |
| 13 | Merge | None, by design. A person merges (`gh stack merge` exists and is not used) | None, by design |

## Fallbacks, in order

1. A stack on GitHub needs `gh stack`. Without it, or when `gh stack submit` fails: one PR per bucket, each
   targeting the branch of the bucket below. This is the same chain GitLab uses, so it is the common path.
2. When even chained branches are not wanted (`factory.prLayout` is `single`): one PR for the whole plan.
3. When the host is unknown or the tool is missing: stop before step 4, say what is missing, and leave the commits
   on the local branches. `factory.mode: local` behaves this way on purpose.

## Known limits (from the spike)

- A new GitLab account may need identity verification before pipelines run. Until then every pipeline fails
  instantly with no jobs and no reason.
- `gh pr checks --watch` prints each finished row twice. Use the exit code, not the text.
- Screenshots live on their own `factory-screenshots` branch, so they add nothing to `main`. That branch only grows;
  a project that wants it pruned deletes and recreates it (the links are pinned to commits, so old links in merged
  PRs keep working as long as those commits are not garbage-collected).
- Pushing that branch runs the project's pre-push hook with `REVIEW_MODE=off`: the images are not code to review. The
  protected-branch stop still applies, and `--no-verify` is never used.
- Self-managed GitLab and GitHub Enterprise are not tested.
