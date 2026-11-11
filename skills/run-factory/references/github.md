# GitHub operations for the factory

Status: proven in the rehearsals (a stack of three PRs, a red lower layer, a restack, screenshots in a PR body).
Needs the `gh` command, logged in. `gh stack` (an extension, v0.3.0 when tested) is optional.

Each heading is a **[host: ...]** step named in `SKILL.md`. Commands are run from the project root.

## branches

- `prLayout` `stack` and `gh stack` installed: the first bucket `gh stack init <branch>`, the next ones
  `gh stack add <branch>`. Commit with plain `git commit`, not `gh stack add -m`. When the run starts on a branch
  other than the default branch, base the stack on it: `gh stack init --base <start branch> <branch>` (the stack's
  trunk is the default branch otherwise, and the PR diffs would include the start branch's own commits). The start
  branch must be pushed first. Do not fall back to plain `gh pr create` just because of this: it gives chained
  PRs that GitHub does not show as a stack.
- `stack` without `gh stack`: `git switch -c <branch>` from the previous bucket's branch (the first one from the
  start branch). Each PR will target the branch below it.

## open

- `stack` with `gh stack`: `gh stack submit --auto --open`. This cannot set a body.
- Otherwise, for each branch from the bottom up: `git push -u origin <branch>`, then
  `gh pr create --base <branch below, or the default branch> --head <branch> --title "<title>" --body-file <file>`.

## description

`gh pr edit <number> --body-file <file>`. Find the number with
`gh pr list --head <branch> --json number --jq '.[0].number'`.

## wait for CI

`gh pr checks <number> --watch --interval 5`. It blocks until the checks finish and exits 0 when they pass and 1
when one fails. Judge by the exit code, not the text (finished rows are printed twice).

## read the failure

Take the run id from the check URL (`.../actions/runs/<id>/...`), then `gh run view <id> --log-failed`, and pass
the output through `node scripts/factory-guard.mjs clean-log`.

## push a fix

`gh stack push` for a stack, `git push` for one branch.

## restack

After a fix on a lower layer of a stack: `gh stack rebase --upstack` from that layer, then `gh stack push`. Without
`gh stack`, restack by hand as `SKILL.md` describes.
