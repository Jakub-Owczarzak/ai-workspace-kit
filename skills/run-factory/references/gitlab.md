# GitLab operations for the factory

Status: proven on gitlab.com in a rehearsal (a chain of two merge requests, a red bottom layer, a fix, a restack, green
pipelines, screenshots in a merge request description). Needs the `glab` command, logged in
(`glab auth login --hostname <host>`; the token is yours, the kit never stores it).

GitLab has no stack tool: a stack is a chain of merge requests (MRs), each targeting the branch of the one below.
This skill says "PR" for a pull request or an MR.

**Run every command from inside the project's clone.** `glab` reads the git remotes of the current folder, and its
`-R <project>` flag does not override that.

Each heading is a **[host: ...]** step named in `SKILL.md`.

## branches

No stack tool: `git switch -c <branch>` from the previous bucket's branch (the first one from the start branch).

## open

For each branch from the bottom up: `git push -u origin <branch>`, then
`glab mr create --source-branch <branch> --target-branch <branch below, or the default branch> --title "<title>" --description "<one line>" --yes`.
The pre-push hook runs on the push, as for any push. A new GitLab account may need identity verification before
pipelines run; until then every pipeline fails at once with no jobs and no reason.

## description

Find an MR by its branch: `glab mr view <branch> -F json` (the `iid` field is the number). Set the body from a file:
`glab mr update <branch> --description-file <file>`.

## wait for CI

`glab ci status --wait --compact -b <branch>`. It blocks until the pipeline ends and exits 0 when it passed and 1
when it failed. `-b` names the branch, so you do not have to switch to it.

## read the failure

`glab ci trace <job name> -b <branch> | node scripts/factory-guard.mjs clean-log --lines 12`. The job name is the one
`glab ci status` prints (`check [test]` means the job is `check`). The raw trace is long and full of terminal codes;
the cleaned tail ends with the failing command's message and `ERROR: Job failed: exit code 1`.

## push a fix

`git push`, a normal push.

## restack

Restack by hand as `SKILL.md` describes: for each upper branch, bottom to top, `git switch <upper>`,
`git merge --no-edit <the branch below it>`, `git push`. Proven here: the fixed README reached the upper layer
with no force-push, and both pipelines went green.

Limit: the merge result is new content with no review record. With `review.mode` `advisory` the pre-push hook only
reminds. With `required` it blocks, so run a quick review of the merge and record it before pushing. This was not
tried here.

## screenshots

`node scripts/e2e-shots.mjs publish --dir .claude/factory/shots/<id> --subdir <branch>` prints Markdown with
`https://<host>/<project>/-/raw/<commit>/<path>` links. Proven: the file at that commit was fetched through the
API at the same size as the local PNG, the commit is an orphan (no parent), and with `?render_html=true` the MR's
`description_html` holds an `<img>` for each image (GitLab lazy-loads them through `data-src`). Not seen in a logged-in
browser.

## Not tried

- Merging the MRs. A person does that. When the bottom MR is merged and its branch deleted, GitLab may retarget the MR
  above; that was not tried here.
- Self-managed GitLab: the host name comes from the remote (`factory.host` `gitlab` for an address the script cannot
  recognize), and nothing else is specific to gitlab.com. No server was available to test it.
- Pipelines with several stages, or merge-request pipelines that need approval.
