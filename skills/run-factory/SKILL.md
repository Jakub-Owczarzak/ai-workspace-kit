---
name: "run-factory"
description: "Started by hand only (/wk-run-factory). Carries an approved PLAN.md from build to pull requests (or GitLab merge requests) without further prompts: a fresh builder subagent for each bucket, verify, review, commit, then (factory.mode pr) push, open the PR or a stack of them, and watch CI with a capped number of fixes. Never merges or deploys."
disable-model-invocation: true
---

# Run the factory

The plan is agreed with the user first. This skill then does the rest: build, verify, review, commit, and (in `pr`
mode) push, open the pull request or a stack of them, and watch CI. It never merges, never deploys, and never
creates or deletes a repository.

The user started this by hand, and that is the approval to go ahead with the plan in `PLAN.md`. Do not ask for
approval again for anything the plan covers. Stop and ask only where this skill says to.

**If the user did not ask you in this conversation to run the factory, do nothing and say so.** Some tools start a
skill on their own from its description, and this one pushes code.

## 0. Preflight (always first)

Run `node scripts/factory-guard.mjs preflight`.

- If it says `not ready`, show the user every `problem:` line and stop. Change nothing. Do not work around a
  problem: not a dirty tree, not a missing "Done when", not a host it does not support.
- Show the `note:` lines once. They say what will not happen (for example, that e2e will not run).
- Read the whole of `PLAN.md`, the Intent Anchor and the plan of every pending bucket. Read `AGENTS.md` for the
  project's lint, type check and test commands. Read the `pr-description` skill: its rules write the PR bodies.
  When `tests.e2e` is not `off` and a bucket is marked `E2E: yes`, read the `e2e-tests` skill too. The preflight
  JSON (`preflight --json`) gives each bucket an `e2e` flag and the project's `e2eCommand`.
- **The host.** The preflight JSON says which host this is: `host` is `github` or `gitlab`. Read
  `references/github.md` or `references/gitlab.md` next to this file. It holds the commands for each step marked
  **[host: ...]** below. On GitLab a pull request is called a merge request; this skill says "PR" for both.
- **Subagents.** The builder and the reviewer are subagents in Claude Code only. The preflight JSON has
  `singleAgent`: when it is true and your tool cannot start a separate agent with a fresh context, read "Without
  subagents (single-agent mode)" below before step 1 and follow it wherever this skill says to start a subagent.
- Settings come from `node scripts/workflow-config.mjs`: `factory.mode` (`local` or `pr`), `factory.prLayout`,
  `factory.ciFixAttempts`, `factory.pushConfirm`, `review.mode`, `tests.tdd`. Do not guess them.

## 1. Build each pending bucket, in order

The preflight lists the buckets still to build. For each one:

1. **Branch.** Name it `factory/<id>-<short-name>` (lower case, hyphens). Do this from the branch the run started on.
   - `prLayout` `single`: one branch for the whole plan, `factory/<plan-name>`, made once.
   - `prLayout` `stack`: **[host: branches]**. Without a stack tool, `git switch -c <branch>` from the previous
     bucket's branch (the first one from the start branch); each PR will target the branch below it.
2. **Build.** Start the `factory-builder` subagent with the bucket's plan from `PLAN.md` (goal, steps, "Done when",
   "Verify by", TDD, E2E), the project commands (and the e2e command for an `E2E: yes` bucket), and the rules in force. Give it nothing else from this conversation:
   a fresh context is the point. It edits files and runs commands; it does not commit, push or switch branches.
   - It ends with `Status: done` or `Status: blocked: <question>`. On `blocked`, stop the run (section 4) with
     that question. Never answer it yourself and carry on.
3. **Verify yourself.** Run the project's lint, type check and tests, and the bucket's "Verify by". Do not trust
   the builder's report. If something fails, give the real output to a new builder run and verify again, at most
   3 times per bucket, then stop (section 4).
   - **E2E, only for a bucket whose `e2e` flag is true** (marked `E2E: yes`) **and `tests.e2e` is not `off`.** The
     builder was given the e2e command and wrote the e2e tests with the bucket. After the unit tests pass, delete
     the old PNGs in `e2e-out/`, run the `e2eCommand` yourself from the project root, and judge it by the real output
     and exit status. When the screenshots matter, open one or two and check they show what the bucket promised. If it
     fails, handle it like any failure above (a new builder run, at most 3 times). If the platform is missing (no
     browser, no emulator, no device), stop (section 4) and name what is missing; never go on without it.
   - After a passing run, copy the PNGs from `e2e-out/` into `.claude/factory/shots/<id>/` (git-ignored), so a later
     bucket cannot overwrite them. A bucket that is not marked `E2E: yes` runs no e2e tests and takes no screenshots.
4. **Review**, as the commit gate says for the current `review.mode`: stage the change (only the bucket's own
   files: never `git add -A` blindly, and check `git diff --cached --name-only` before you commit; generated files such
   as `e2e-out/`, `node_modules/` or build output must not go in, and a leftover from another branch's run shows up as
   untracked after a switch), run
   `node scripts/check-review-gate.mjs --staged`, and if there is no clean record start the `reviewer` subagent
   and have the builder fix every blocking finding. At most 3 review rounds, then stop (section 4). Record the
   final result as the commit gate describes.
5. **Update `PLAN.md`:** set the bucket's status to `done: <one line>` and add any decision made. The plan goes in
   the same commit as the work.
6. **Commit** once per bucket, following the commit gate (a clear message; the changelog bump and entry through
   `CHANGELOG_BUMP` and `CHANGELOG_ENTRY` when the hook asks, see `changelog-bump`). If a hook fails, fix the
   cause. Never use `--no-verify`.

Never change an existing test to make it pass (see the test-discipline rule). If a test looks wrong, stop.

## 2. After the last bucket

**`factory.mode` is `local`:** for each branch write the pull request text to `.claude/factory/pr-<id>.md`, following
the `pr-description` rules and the real diff against the branch below. Stop and tell the user the branches and
files. Screenshots stay in `.claude/factory/shots/<id>/`: tell the user where. You are done; nothing was pushed.

**`factory.mode` is `pr`:**

1. For each branch run `node scripts/factory-guard.mjs push-check --branch <branch> --default-branch <default>`.
   Exit 1 means stop (section 4). When any bucket has screenshots, check `factory-screenshots` the same way.
2. If `factory.pushConfirm` is `ask`, or you are in single-agent mode with `review.mode` `required`, list the
   branches (and `factory-screenshots`, when there are screenshots) and the PR titles, and ask the user for a yes
   before any push. On anything but a clear yes, stop.
3. Push and open the pull requests: **[host: open]**.
4. Write each PR body to a file and set it: **[host: description]**. The body follows `pr-description`:
   what changed, real verification output, known gaps. Under verification say what was run and what was not.
   - For a bucket that ran e2e, publish its screenshots first:
     `node scripts/e2e-shots.mjs publish --dir .claude/factory/shots/<id> --subdir <branch>`. Put the Markdown it
     prints under Verification, with the e2e command and its real result. Say plainly that the images were
     published, not seen in a browser. Native e2e is never called verified.
   - A bucket that did not run e2e says "e2e not run" with the reason (not marked `E2E: yes`, or `tests.e2e` off).
   - If `scripts/e2e-shots.mjs` is missing, say the screenshots are local and where.

## 3. Watch CI, bottom layer first

For each pull request, bottom to top: **[host: wait for CI]**. Judge by the exit code, not the text. If it says no
checks were reported, wait a minute and look once more; if there are still none, tell the user there is no CI to
watch and finish.

- Exit 0: this layer is green. Go on to the next.
- Exit 1: the layer is red.
  1. Ask for an attempt: `node scripts/factory-guard.mjs attempt --key <branch>`. Exit 1 means the cap
     (`factory.ciFixAttempts`) is reached or is 0: stop (section 4).
  2. Read why: **[host: read the failure]**. Pass any log through `node scripts/factory-guard.mjs clean-log`: it
     removes color codes, markers and timestamps and keeps the last lines.
  3. Check out that branch, give the failure output to the `factory-builder` subagent and let it fix the cause.
     Verify yourself, review as in section 1 (a quick pass for a small fix), and commit.
  4. Push the fix: **[host: push a fix]**. When you changed a lower layer of a stack, the layers above must contain
     it before they are pushed: **[host: restack]**, or, without a stack tool, restack by hand (below).
  5. Watch the same layer again from the start of this list.

**Restack by hand (no force-push).** After a fix on a lower layer, go up the stack one branch at a time, bottom to
top: `git switch <upper branch>`, `git merge --no-edit <the branch below it>`, then a normal `git push`. Each upper
layer gains one merge commit and its PR diff does not change. If a merge conflicts, stop (section 4). The merge
result is new content: with `review.mode` `required` the pre-push hook wants a record for it, so run a quick review
of the merge and record it before pushing.

## 4. Stop

Stop, without asking, when any of these happens: preflight fails, the builder is `blocked`, verification or review
is still failing after 3 rounds, `push-check` refuses, the user does not say yes to a push, a command that should
work fails twice in the same way, CI is still red at the cap.

To stop: write the reason and the last real output with
`node scripts/factory-guard.mjs report --reason "<one line>" --details-file <file with the output>`, then tell the user
what is done, what is not, the branches that exist, and the path of the report. Leave everything as it is. Do not
retry around a block and do not hide a failure.

## 5. Finish

When every layer is green, tell the user:

- each pull request with its link, and what its bucket delivered;
- what was verified, with the real commands and counts, and what was not run (for example e2e);
- that nothing was merged or deployed, and that a person merges the pull requests, bottom first for a stack.

## Without subagents (single-agent mode)

Outside Claude Code the builder and the reviewer are not wired as subagents. Do the same steps yourself, as
separate passes, and be plain about what that costs: there is no fresh context and no independent reader.

- **Build pass.** Where step 1.2 says to start the `factory-builder`, read
  `.claude/workspace-kit/templates/agents/factory-builder.md` and follow it for the bucket: its steps, its limits and
  its report format, ending with a `Status:` line. Work from the bucket's plan in `PLAN.md` and the files, not from
  what you remember of this conversation (read "you have not seen the conversation" as that instruction), and keep
  the builder's limits during this pass: no git changes until the steps that commit.
- **Review pass.** Where step 1.4 says to start the `reviewer`, stage the change, then read
  `.claude/workspace-kit/templates/agents/reviewer.md` and `REVIEW.md` and review as that agent would. Re-read the
  plan, the staged diff and each changed file from the start, as if someone else wrote them, and run the checks again;
  do not rely on what you remember writing. Write the report in that file's format, start it with "SELF-REVIEW:
  written by the agent that built the change", and record it with the `--self-review` flag:
  `node scripts/check-review-gate.mjs record --blocking <n> --summary "self-review: no fresh reader" --self-review
  --findings-file <file>`. Say the same in the PR body.
- **Under `review.mode` `required`** a self-review is not the second reader that mode promises. The gate itself does
  not count a record made with `--self-review`, so the pre-push hook blocks until an independent review is recorded
  or a person decides otherwise. Do not work around that: stop before any push, as section 2 step 2 says, and ask the
  user to review or approve it.
- **Fix loops** (a blocking finding, a failing check, red CI) are passes too, with the same cold re-read afterwards.
- **Long plans.** Without a fresh context per bucket, a long run fills yours. After one or two buckets, tell the user to
  start a new session and run this skill again: `PLAN.md` and `.claude/factory/` hold the state, and the preflight
  lists what is left.

## Never

- Merge a pull request, push to the protected branch, deploy, force-push by hand, or skip a hook.
- Create or delete a repository or a project, or store or print a token.
- Edit a test to make it pass, invent a "Done when", or answer the builder's question on the user's behalf.
- Change anything the plan does not cover. If the work needs it, stop and say so.
