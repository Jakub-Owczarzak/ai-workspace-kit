# The factory: from an approved plan to pull requests

The factory is an **opt-in layer** on top of the solo, team and org profiles. After you approve a plan, agents
carry it through build, verify, review and commit, and (in `pr` mode) push, open the pull request or a stack of
them, and watch CI. **It never merges and never deploys.** A person merges. It is off in every profile until you
turn it on. The setup asks about it right after the profile and, on a yes, installs the whole layer; to add it to a
project later, run the setup again and answer yes.

Everything here is marked **proven** (it ran for real, and `docs/factory-rehearsal.md` or `docs/factory-spike.md`
has the output) or **not proven** (written from documentation, or never run).

## Starting it

1. Plan with the `goal-first-planner` skill and approve the plan. Each bucket needs a "Done when".
2. Check the controls in `.claude/workflow.json`. The setup sets `factory.mode` to the answer you gave (`local` or `pr`);
   it is `off` when you said no.
3. Start it by hand: `/wk-run-factory` (in Codex: `$wk-run-factory`). The skill refuses to run if you did not ask
   for it in the conversation, because it pushes code.

The skill runs `node scripts/factory-guard.mjs preflight` first. If it says `not ready`, it shows the problems and
stops without changing anything (a dirty tree, a bucket without "Done when", an unsupported host).

## What it does, per bucket

1. A branch `factory/<id>-<name>`.
2. A fresh `factory-builder` subagent builds the bucket, runs the checks and fixes its own failures (at most 3 rounds
   inside its run). It edits files and runs commands; it never commits, pushes or switches branches. It writes its
   full report to a **handoff file** (`.claude/factory/handoff/<bucket>.md`, git-ignored) and replies with a few lines
   and a status line, so the orchestrator does not carry the report in its own context.
3. The orchestrator verifies by itself, once per bucket (lint, types, tests, the bucket's "Verify by", in one batched
   call) and does not trust the builder's report. `factory-guard.mjs handoff-check` confirms the handoff is
   complete. For a bucket marked `E2E: yes` it also runs the end-to-end command.
4. A fresh `reviewer` subagent reads the staged change and the handoff. Every blocking finding and every finding tagged
   `[bug]` (wrong behaviour: a race, a missed case, a broken test) goes back to a builder and is verified and re-reviewed
   (at most 3 rounds); only `[nit]` findings (style, taste) may remain, and they are listed in the PR. **No known bug is
   left for the PR text.** Before anything is built, `factory-guard.mjs baseline` records which project checks already
   fail, so a pre-existing failure is named as such in the PR and a check that passed at the start must still pass.
5. One commit per bucket, through the normal hooks (never `--no-verify`).
6. After the last bucket: `local` mode writes the PR text to `.claude/factory/pr-<id>.md` and stops. `pr` mode
   runs `push-check` (feature branches only), pushes, opens the PR or stack, writes the bodies from the real diff,
   and watches CI bottom layer first. A red layer gets a capped number of fix attempts, then it stops and writes a
   report.

## The controls (`.claude/workflow.json`)

| Control | Values | Default (solo / team / org) | What it does |
|---|---|---|---|
| `factory.mode` | `off`, `local`, `pr` | off / off / off | `local` builds, reviews, commits and writes PR text, then stops before any push. `pr` also pushes, opens PRs and watches CI |
| `factory.prLayout` | `single`, `stack` | stack / stack / stack | One PR, or one layer per bucket |
| `factory.ciFixAttempts` | number, `0` = report only | 3 / 3 / 2 | How many times it may fix a red CI run before it stops |
| `factory.host` | `auto`, `github`, `gitlab` | auto | `auto` reads the git remote |
| `factory.pushConfirm` | `auto`, `ask` | auto / auto / ask | Whether it pushes by itself or asks for a yes first |
| `factory.fastFix` | `off`, `docs` | docs / docs / off | A tiny documentation-only fix (at most 10 lines, Markdown and README files; checked by `factory-guard.mjs fast-check`) may be made by the orchestrator with a self-check and no builder or reviewer. Code always goes to a builder. Not used under `review.mode: required` |
| `tests.e2e` | `off`, `browser`, `native` | off / off / off | End-to-end tests and screenshots; works with or without the factory |

The full table, with the other controls, is in `docs/workflow-profiles.md`.

## Hosts

| Host | Stack | Status |
|---|---|---|
| GitHub | `gh stack` (a layered PR stack); one PR per bucket where `gh stack` is missing | `gh stack` **proven** on a scratch repo (v0.3.0). The one-PR-per-bucket fallback is **not proven** |
| GitLab | Chained merge requests through `glab` | **Proven** on gitlab.com (red bottom layer, fix, no-force restack, green). A self-managed server is supported by design and **not tested** |

Where the stack tool is missing, a lower-layer fix is propagated by merging the lower branch into each upper one,
bottom to top, with a normal push. The factory never force-pushes.

## End-to-end tests and screenshots (`tests.e2e`)

- `browser`: Playwright in a headless browser. **Proven** (Playwright 1.65), including a live factory run with an
  `E2E: yes` bucket and screenshots in the PR body.
- `native` (experimental): Maestro against a platform you supply and run (Expo, Android Studio, Xcode or a device). The recipe is
  written from the tool's documentation. **Not proven** on a device, and the factory never calls it verified.
- Screenshots go to a separate `factory-screenshots` branch, linked by commit SHA in the PR body. The PR says the
  images were published, not seen in a browser.

## Other AI tools

Subagents and hooks are Claude Code features. In Cursor, Codex, OpenCode and Cline the factory runs as a
**single agent**: the same steps as separate passes, with no fresh context and no independent reader. The review is
a labeled self-review (`record --self-review`), which the gate does not count under `review.mode: required`, so the
push stops and asks you. These tools were **not run** here; the adapters were written from their documentation
dated 2026-11-11. See `adapters/`.

## Resuming

If every bucket is built and factory pull requests are open (after a CI outage, a closed session or a stop), switch to
the **top branch of the stack** (the one whose `PLAN.md` shows the buckets done) and start `/wk-run-factory` again: the preflight reports `resume` instead of "every bucket is done", and the run goes straight to
watching the pull requests of that stack (the current branch and its ancestors, not another run's), lowest layer first,
with the attempt counts kept in `.claude/factory/state.json`. (GitHub only so far.)

## Stops and limits

It stops, without asking, when preflight fails, a builder reports `blocked`, verification or review still fails
after 3 rounds, `push-check` refuses, you do not say yes to a push, a command fails twice in the same way, or CI is
red at the cap. It then writes `.claude/factory/report.md` with the reason and the real output, and leaves
everything as it is.

## What has not been run

a `single` layout in `pr` mode; a builder returning `blocked`; a review with blocking findings across the 3-round limit; the
counter's stop with a positive cap after real fix attempts (the live counter stop used `ciFixAttempts: 0`; the other live
stops were the agent's judgment about a check that needs an outside approval); the `--self-review` block in a real push; a separate yes for each fix push under `pushConfirm: ask` (the skill
asks now; not run); native e2e; any non-Claude tool (see `docs/other-tools-checklist.md`). The unit tests cover
the guard script; the live runs above cover the rest. What the last round did prove is in
`docs/factory-rehearsal.md` (the CI fix loop on a repository with CI) and `docs/factory-trial.md`.

## Cost

Every turn re-reads the whole context of the agent that takes it, so a small change still costs real tokens. In a
real-project trial the orchestrator was about 70% of the cost (`docs/factory-trial.md`). The skill therefore keeps the
orchestrator's context small (a plan excerpt instead of the whole `PLAN.md`, batched and filtered commands, handoff
files instead of relayed reports) and lets the builder carry the build-check-fix loop. Whether that helps is being
measured against the trial's numbers, which are in `docs/factory-trial.md`.

## Permissions

To run it without a prompt on every command, see `docs/permissions.md`, including its warning.
