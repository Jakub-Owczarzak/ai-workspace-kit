# Factory rehearsal: what ran and what did not

Bucket 3b of `PLAN.md`. The `run-factory` skill was followed step by step, on 2026-11-11, on a scratch GitHub
repository with a tiny Node project, a two-bucket plan, `factory.mode: pr`, the solo profile and `gh stack` v0.3.0.
The project had a CI-only check (every exported function must be named in `README.md`) that its local `npm test`
does not run, so the build was green locally and red in CI.

## What ran, with real results

| Step | Result |
|---|---|
| Preflight | `factory preflight: ok`; listed buckets 1 and 2 |
| Branches | `gh stack init factory/1-greeting`, then `gh stack add factory/2-farewell` |
| Build | A fresh builder subagent per bucket, each ending `Status: done`; local `npm test` was run by the caller: 4 of 4, then 7 of 7 |
| Review | A fresh reviewer subagent per commit, `Blocking: 0` each time; results recorded with `check-review-gate.mjs record` |
| Push checks | `push-check` allowed both factory branches and refused `main` (exit 1) |
| Open the stack | `gh stack submit --auto --open` created PR 1 and PR 2 and the stack; the pre-push hook let the factory branches through |
| PR bodies | Written from the real diff and verification output, set with `gh pr edit --body-file` |
| CI, bottom layer red | `gh pr checks 1 --watch` exited 1; `gh run view <id> --log-failed` showed `README.md does not mention: greet` |
| Fix on a **lower** layer | A fresh builder fixed `README.md`; the caller verified it, a reviewer passed it, it was committed on layer 1 |
| Restack | `gh stack rebase --upstack` rebased layer 2 onto layer 1's new tip; `gh stack push` pushed it with no manual force |
| CI, top layer red | After the push layer 1 went green and layer 2 failed on `farewell`; one more attempt fixed it; both layers ended green |
| Attempt cap | `attempt` returned `fix` for attempts 1 to 3 and `stop` (exit 1) for the fourth; `report` wrote `.claude/factory/report.md` |

Nothing was merged.

## How it differed from a real session

- The skill and the two agent files were read and followed by this session as the orchestrator, with general-purpose
  subagents carrying the text of `factory-builder.md` and `reviewer.md`. An agent file installed in the middle of a
  session is not registered as an agent type until the next session, so the agent **registration** was not tested.
- The skill was not started with `/wk-run-factory`, so the hand-start behavior was not tested either.
- One reviewer said "no plan" although `PLAN.md` existed, and one claimed `PLAN.md` was untracked when it was tracked;
  the caller checked and dismissed it. Review reports are input to check, not facts.

## Not run in this rehearsal

- `factory.prLayout` `single`, and the stack fallback without `gh stack` (one PR per bucket, `gh pr create`).
- `factory.mode` `local`, and `factory.pushConfirm` `ask`.
- A builder that returns `Status: blocked`, and the 3-round limit on fixes (a blocking review finding was fixed in one
  round, see Bucket 4b; the limit itself was not reached).
- The CI cap reached in a real pipeline (only the counter and the report were exercised).
- A bucket plan without a "Done when" (covered by unit tests of the guard, not by a run).
- GitLab, e2e and screenshots (later buckets).

## Bucket 4a: screenshot publish, live check

Run on the same scratch repository, with a real PNG made by Playwright in the spike:

| Check | Result |
|---|---|
| `e2e-shots.mjs publish --json` | Published to `factory-screenshots`; returned the commit and the file path |
| The repo afterwards | Same branch, clean tree, same branch list, one worktree: exactly as before |
| The remote | The branch list gained only `factory-screenshots`; the commit has **no parent** (an orphan) and holds only the image |
| The image on GitHub | Fetched through the contents API at that commit: 7309 bytes, equal to the local file |
| In a PR description | The `markdown` output was added to a PR body; GitHub's rendered HTML held an `<img>` with the commit-pinned URL |

Not seen: the image displayed in a logged-in browser. The pre-push hook in this repository allowed the push; the
`REVIEW_MODE=off` override is covered by a unit test with a hook that refuses without it.

## Bucket 4b: an `E2E: yes` bucket through the factory path

A third bucket, "Greeting page", marked `E2E: yes`, was added on top of the open stack, with `tests.e2e: browser`,
`npm run e2e   # e2e` in `AGENTS.md`, the kit upgraded in the project, and the dependency named in the plan.

| Step | Result |
|---|---|
| Preflight | `ok`, with the note "E2E will run for bucket 3 with: npm run e2e"; no warning about the screenshot helper, which was installed |
| Build | A builder subagent added the page, `@playwright/test`, the config, the script, two specs and the `.gitignore` line; it reported `Status: done` |
| Verify | The caller deleted the old PNGs and ran `npm test` (7 of 7) and `npm run e2e` (2 of 2, exit 0) itself, then **opened both screenshots**: they showed `Hello, Ada!` and `Goodbye, Ada!` |
| Review round 1 | **1 blocking finding**: `AGENTS.md` still said "no dependencies and no lock file" and did not list the new files. This is the first time a review blocked in a rehearsal |
| Fix and round 2 | A fresh builder fixed only `AGENTS.md`; the caller updated the plan's constraint and decision log; round 2 found `Blocking: 0`; the result was recorded and committed |
| Push and PR | `gh stack submit` added PR 4 as a third layer and left PRs 1 and 2 up to date |
| Screenshots | `e2e-shots.mjs publish` added a commit on top of the existing `factory-screenshots` branch (1 parent); a remote image was the same size as the local file; the PR body rendered 2 `<img>` tags |
| CI | Green on the new layer (CI runs `npm test` and the README check, not Playwright) |

What it showed:

- The review loop works as designed: a real blocking finding, a targeted fix by a fresh builder, a second round.
- A reviewer that ran `npm --prefix <folder> run e2e` got "Missing script". The skills now say to run the e2e command
  from the project root.
- Playwright was installed by the builder only because the approved plan named it, as the builder's limits require.
- Still not seen: the published images in a logged-in browser, and e2e in CI.

## Bucket 5: the same loop on GitLab

A new private project on gitlab.com, the same small project, two buckets: "Greeting" (a function; the CI-only README
check fails on it) and "Greeting page" (`E2E: yes`). `factory.host` was `auto`, so the host was read from the remote.

| Step | Result |
|---|---|
| Preflight | `ok`, `host gitlab`, with the note "GitLab has no stacks: ... chained merge requests"; no `gh` needed |
| Build and review | Fresh builders and reviewers as before; the e2e bucket's plan now included the `AGENTS.md` update, and the builder did it, so review round 1 had no blocking finding this time |
| Open | `git push -u`, then `glab mr create --source-branch ... --target-branch ...` for each branch bottom-up: MR 1 into `main`, MR 2 into `factory/1-greeting` |
| Screenshots | `e2e-shots.mjs publish` from the clone; the file at that commit was fetched through the API at the same size (5154 bytes); the commit has no parent; the MR's rendered HTML holds an `<img>` for each image |
| Descriptions | `glab mr view <branch> -F json` gave the `iid`; `glab mr update <branch> --description-file` set the body |
| CI, bottom layer | `glab ci status --wait --compact -b factory/1-greeting` exited 1 without switching branches; `glab ci trace check -b ...` through `clean-log` showed `README.md does not mention: greet` |
| Fix | A fresh builder fixed `README.md`; the caller verified it; a reviewer passed it; committed |
| Restack | `git merge --no-edit factory/1-greeting` in the upper branch, then a normal `git push`: no force-push |
| CI again | Both layers `success`, exit 0 |

What it showed:

- **A mistake of mine, caught by the reviewer.** After switching to the lower branch, `git add -A` staged leftover
  `e2e-out/` files from the other branch's run. The reviewer noticed the staging had changed mid-review, and the caller
  committed `README.md` only. The skill now says to stage the bucket's own files and check `git diff --cached
  --name-only` before every commit.
- In `advisory` mode the pre-push hook only reminded that the merge result had no review record. In `required` mode it
  would block, so the skill now says to review and record the merge first. Not tried.
- `clean-log` turned a 100-line trace into the lines that matter, for GitLab and for a real GitHub log.
- Not seen: the images in a logged-in browser; merging the MRs; self-managed GitLab.

## Bucket 6: a single-agent run (no subagents)

This tests the skill's text and the scripts. It does **not** test any other tool: Cursor, Codex, OpenCode and Cline are
not installed here, and the run was done by Claude Code in `local` mode with the two agent files deleted. Nothing was
pushed.

| Step | Result |
|---|---|
| Preflight | `ok`, with the note "No .claude/agents/factory-builder.md: ... single-agent mode", and, with `review.mode` `required`, the note that the review becomes a self-review that stops before any push |
| Build pass | Read `factory-builder.md` from the kit folder and followed it: a failing test first (module not found), the code, a green run (9 of 9), the CI-only README check, a report ending `Status: done` |
| Review pass | Staged the bucket's own files by path, read `reviewer.md` and `REVIEW.md`, re-read the whole diff and re-ran the tests, wrote the report |
| Record | Recorded with `--self-review`. **Before that flag existed, the gate said `ok` in `required` mode** and the hook would have let the push through |
| After the fix | `required`: `push blocked, ... is a self-review ... wants an independent review`, exit 1. `advisory`: a reminder, exit 0 |
| End | `local` mode: the PR text was written to `.claude/factory/pr-4.md`, marked self-review; the remote has no ref for the branch |

What it showed:

- **The gate could not tell a self-review from an independent one**, so decision 53 (stop for a human review) was
  only a written instruction. `record --self-review` now makes the gate enforce it in `required` mode. The flag is
  set by the assistant about itself, so it is still an attestation, not proof.
- The builder's role text says "you have not seen the conversation", which is false for one agent. The skill now says
  to read that as "work from the plan and the files", and to keep the no-git-changes limit during the build pass.
- A pass by the same agent is weaker than a fresh reader, and this run cannot show how much. The self-review found
  nothing that the build pass had not already considered.

## Small things learned

- `apply` rewrites `.claude/workspace-kit/choices.json` and `manifest.json` each time. They are tracked in a project
  that commits the kit folder, so the tree is dirty afterwards and the factory preflight refuses until they are committed.
- Redirecting stderr of a native command in PowerShell (`2>&1`) turns normal progress lines into an error record.

## The CI fix loop on a repository with CI (Bucket 9, scenario 1, 2026-11-11)

A private scratch GitHub repository with a tiny Node library, the team profile, `factory.mode: pr`, `factory.ciFixAttempts: 2`, a
two-bucket plan (`farewell`, `shout`) and three CI jobs: `test` (the same as the local `npm test`), `docs` (every exported function
must be named in `README.md`; the local tests do not run it) and `external` (always red: it stands for an approval decided outside
the repository). The agent files were the registered `factory-builder` and `reviewer` of the current kit, started by `/wk-run-factory`
in a fresh Claude Code session on Sonnet 5.5.

| Step | Result |
|---|---|
| Build, verify, review, commit | Both buckets built; local tests, lint and type check green; advisory review with 0 blocking findings |
| Push and open | A stack of two PRs (a stack tool left the top branch checked out) |
| Red CI, found by the loop | `docs` failed on both PRs (the README did not name the new functions), `external` failed on both |
| Fix attempts | The failing log was read through `clean-log`; `factory-guard.mjs attempt` counted 1 of 2 on each branch; a fresh builder fixed the README on each; a quick re-review of each fix |
| Restack | The upper branch got the lower fix by `git merge` and a normal push, no force |
| After the fixes | `test` and `docs` green on both PRs; `external` still red |
| Stop | The agent stopped without using the second attempt, because the log of `external` says it needs an approval outside the repository; it wrote `.claude/factory/report.md` with the reason, the attempts used and the log |
| Merged or deployed | Nothing |

What this proved: a red CI run on a real pipeline is detected, read, fixed by a fresh builder, re-reviewed and pushed; the attempt
counter is kept per branch; the by-hand restack works without a force push; the stop report is written with the real log.

What it did not prove: **the cap itself.** The agent stopped by judgment after one attempt per branch (the failure looked unfixable
by code), not because `attempt` returned stop. The skill now says to stop early for a check that needs an outside decision; the cap
path, with a failure that looks fixable and is not, is still to be run. The `typecheck` of the scratch project is a no-op and proves
nothing; e2e did not run (no bucket was marked `E2E: yes`).

Found and fixed: the first CI-fix builder was started on the wrong branch (the stack command had left the top branch checked out); it
stopped without editing. The skill now says to switch to the branch and print `git branch --show-current` in the same call, and the
builder checks the branch name before it edits.

Tokens (input-token equivalents, assumed price ratios): the orchestrator 50 turns, about 532,000; eight subagents (three builders,
three quick or full reviews and two CI-fix builders and reviews), about 241,000; total about 773,000 for a very small project. The
orchestrator is again about 70% of it, and each CI fix cycle costs about ten of its turns.
