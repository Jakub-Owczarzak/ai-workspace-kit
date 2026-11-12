# The workflow step by step, and the skills

Sections 5 and 6 of the former README: the workflow from install to a released change, and how the skills connect. Back to the [README](../README.md).

## 5. The workflow, step by step

The whole path of one change, from request to a maintained project. Each step names the pieces involved, the
control that tunes it, and what can stop you. Step 0 happens once per project.

```text
   REQUEST
      |
      v
   1 PLAN ......... goal-first-planner writes PLAN.md (Intent Anchor, bucket plan); you approve
      |             tuned by: planning.gates (off | anchor | full)
      v
   2 BUILD ........ rules always on; workspace-router sends the assistant to the right skill
      |             guards: docs-fresh, test discipline (+ test-edit guard), ui-change flagging
      v
   3 VERIFY ....... lint, type check, tests; the real output is shown
      |
      v
   4 REVIEW ....... reviewer subagent checks the change against PLAN.md and REVIEW.md
      |             tuned by: review.mode (off | advisory | required)
      |             blocking finding?  yes --> back to 2 (fix), then review again
      v
   5 COMMIT ....... commit gate: checks, design sync if UI rows are pending, changelog entry
      |             hook: lint-staged, type check, tests, docs-fresh check, changelog
      v
   6 PUSH ......... pre-push hook: no direct push to the protected branch you named; review gate
      |             tuned by: review.mode
      v
   7 PULL REQUEST . pr-description writes the text; CI runs; merge; the release workflow bumps the version
      |
      v
   8 KEEP IT TRUE . write-project-overview (refresh), check-config
```

### Step 0: install (once per project)

```text
   npx ai-workspace-kit init      copies the kit to .claude/workspace-kit/ (all or nothing; nothing else touched)
      |
      v
   prompt: "Read .claude/workspace-kit/skills/setup-workspace/SKILL.md and follow it"
      |
      v
   look at the project, read-only (stack, branch, hooks, CI, commands, existing assistant files, existing skills)
      |
      v
   questionnaire from catalog/options.json, rounds of at most four questions:
      1 tools + profile   2 strictness controls   3 what to install, a group at a time   4 project facts
      |
      v
   answers.json --> apply --dry-run (created / skipped / manual / notes / warnings) --> you say yes --> apply
      +--> skills ............ wk-<name>/ in the folder(s) your tools read
      +--> rules ............. one marked block in CLAUDE.md or AGENTS.md
      +--> templates ......... PLAN.md, REVIEW.md, CHANGELOG.md (only if missing; never replaced)
      +--> workflow profile .. .claude/workflow.json
      +--> scripts + hooks ... scripts/*.mjs; a marked block chained into your pre-commit / pre-push
      +--> settings .......... .claude/settings.json keys added (plan mode for team and org, the test-edit guard)
      |
      v
   finish the MANUAL lines, verify (scripts run, no leftover placeholders, a second apply changes nothing)
      --> summary --> no commit
```

Skills involved: `setup-workspace` (started by hand; it stays in the kit folder), then `write-project-overview`
when `AGENTS.md` does not exist. Details and the safety rules: [section 8](install-and-update.md#8-install-and-use).

### Step 1: plan

```text
   (the planner's own phases are called P0 to P5 here, to keep them apart from the workflow steps)

   P0 gather context (read the repo, do not ask what the files answer)
      |
   P1 goal interview (rounds of 3-5 questions): outcome, why now, success, non-goals, constraints, risks
      |
   P2 INTENT ANCHOR ....... goal, success criteria, non-goals, constraints (your words), assumptions, risks
      |                     you approve  --> saved in PLAN.md
   P3 BUCKET MAP .......... 3-8 small buckets, each with something visible or testable; you approve
      |
   P4 PER-BUCKET PLAN ..... steps, output, done when, verify by, TDD yes/no, review focus, risks
      |                     you approve  --> copied into PLAN.md "Current bucket"
      v
   build the bucket
      |
   P5 CHECKPOINT .......... what was done, verification, drift check against the Intent Anchor,
      |                     decisions logged, "proceed, adjust or stop?"
      +---------------------> next bucket (back to P4)
```

When it applies is the `planning.gates` control:

```text
   planning.gates = off ...... the planner runs only when you ask for a plan (set it yourself; no profile uses it)
   planning.gates = anchor ... non-trivial work needs an approved Intent Anchor in PLAN.md before any code
                               (the default in solo and team)
   planning.gates = full ..... the same, plus success measurements (metric, baseline -> target, how measured)

   routine work is exempt (a tight request, a small blast radius, code the tests already cover)
   anchor/full is a rule the assistant follows; plan mode (offered by setup) is the real stop in the terminal
```

Skills involved: `goal-first-planner`. Files: `PLAN.md` (read later by the reviewer). The plan is updated in the
same commit as the work it describes.

### Step 2: build

Always-on rules shape every change. The router skill tells the assistant which skill to read for the task.

```text
   a task arrives
      |
      v
   workspace-router (read once per session) --> reads the skill for the area, not just its description
      |
      +--> rules in force on every change:
      |      readable-code    full-word names, small units, one source of truth, failure handled on purpose
      |      repo-tidiness    every file has one home, listed in AGENTS.md; extend, do not duplicate
      |      docs-fresh       update the documents that describe the change, in the same turn
      |      verification     check names, numbers and paths against the code before writing them
      |      skill-routing    read a skill whole before using it; project files outrank notes and memory
      |      ui-change-flagging (only with a design file) one row per visible UI change
      v
   change the code + the documents it makes false
```

A bug fix has its own path, because the test is the proof:

```text
   bug reported
      |
      v
   write a test that reproduces it; run it; SHOW it failing for the expected reason
      |
      |   with tests.guard on:  node scripts/test-edit-guard.mjs start --reason "<what is fixed>"
      |   ... write the failing test(s), then:  node scripts/test-edit-guard.mjs lock
      v
   change the CODE (the guard blocks edits to existing test files; never weaken the test)
      |
      v
   run the test: passing; run the whole suite; show both outputs
      |   with tests.guard on:  node scripts/test-edit-guard.mjs stop
      v
   done
```

New logic is test-first when `tests.tdd` is `on`, or when the plan marks the bucket `TDD: yes`.

### Step 3: verify

The assistant runs the project's lint, type check and tests, and reports the command and its real output
(counts, exit status). What cannot be tested (a screen, a device) is said plainly. "Tested" is never said about
something that was only read. Rules: `verification`, `test-discipline`.

### Step 4: review

```text
   changes staged
      |
      v
   node scripts/check-review-gate.mjs --staged
      |
      +-- "review-gate: ok" ----------------------------------> go to step 5
      |
      +-- no clean record for these exact contents
             |
             v
          reviewer subagent (fresh context; Read, Grep, Glob, Bash; told to change nothing)
             |   reads PLAN.md (Intent Anchor, current bucket "Done when"), REVIEW.md, AGENTS.md
             |   reads the diff, runs lint / type check / tests, walks the checklist
             v
          report: blocking findings first, then at most five others, ending "Blocking: <n>"
             |
             +-- blocking > 0 --> fix --> review again (changed contents need a new record)
             |
             v
          node scripts/check-review-gate.mjs record --blocking <n> --summary "..." --findings-file ...
             |     writes .claude/reviews/<git tree id>.md
             v
          go to step 5
```

`review.mode` decides how much this matters: `off` (only when asked), `advisory` (the assistant runs it; the push
hook only reminds), `required` (the push hook blocks a push whose contents have no clean record).
The record names a git **tree** (the exact file contents), so a review made before the commit still matches the
commit made right after it, and any later edit makes the record stale.

### Step 5: commit

The commit gate has a fixed order:

```text
   1 fix lint, type and test errors ...... never commit with any failing
   2 run the review ...................... step 4
   3 design sync ......................... only if the pending-changes list has rows (figma-sync)
   4 commit .............................. the hook runs:
          lint-staged / lint  -->  type check  -->  tests  -->  docs-fresh check  -->  changelog entry
   5 only a human pushes
```

The docs-fresh check (`docs.check`) says when source changed but `AGENTS.md` is not in the commit: `warn` prints a
message, `strict` blocks the commit. The changelog step asks for a bump type and a one-line entry (or reads
`CHANGELOG_BUMP` and `CHANGELOG_ENTRY` for a commit with no terminal). Merges and commits that only touch the
changelog or the lock file are skipped. Skill: `changelog-bump`.

### Step 6: push

```text
   git push
      |
      v
   pre-push hook, for each ref being pushed
      |
      +--> is it the protected branch (the one you named at setup, for example main)? --yes--> BLOCKED:
      |      push a branch, open a pull request
      |
      +--> review gate on the tip of the ref (review.mode)
             off .......... silent
             advisory ..... a reminder if there is no clean record; the push goes ahead
             required ..... BLOCKED if there is no record, or the record has blocking findings
      v
   pushed   (the hook fails open: no git, a crash, or no node on the PATH never stops a push)
```

Assistants commit when asked and never push; a person pushes. **The one exception is the opt-in
[factory](profile-flows.md#the-factory-an-optional-layer)**: when you set `factory.mode` to `pr` and start it by hand, it may push
**feature branches** (never the protected branch, which the hook still refuses) and open pull requests. It never
merges.

### Step 7: pull request and release

```text
   pr-description ---> reads the real diff, commits and PLAN.md; writes the text (never opens the PR)
        |
        v
   you open the PR; the project's own CI runs (the kit ships only the release workflow template, no test CI)
        |
        v
   merge to main
        |
        v
   release_bump workflow (template) ---> opens a release PR: bumps the version files, folds
                                         "Unreleased" in CHANGELOG.md into a version heading
```

Skills involved: `pr-description`, `changelog-bump`. Template: `templates/workflows/release_bump.yaml`.

### Step 8: keep it true

```text
   the overview may be stale?
      |
      v
   write-project-overview, refresh mode
      |   node scripts/overview-check.mjs  --> missing paths, missing npm scripts, version mismatches,
      |                                        forgotten folder entries, leftover planning labels
      |   + the assistant reads the lines the script cannot judge
      v
   a table of problems (line, statement, status, evidence, proposed edit) --> you approve LINE BY LINE
      v
   only the approved lines change; "Last updated" is set; the check runs again

   the setup may have drifted?
      |
      v
   node scripts/check-config.mjs  --> skill lint, @ imports, doc size  (no Claude needed)

   a newer kit version?
      |
      v
   npx ...@latest init --force, review the diff, apply again (section 9)
```

## 6. The skills and how they connect

Eleven skills (`run-factory` and `e2e-tests` are the newest). In a project they are installed as `wk-<name>` (so `/wk-pr-description`); this page uses the plain
names. **Started by hand** means only you can start it (`/name`); otherwise Claude may pick it from its
description. The profile does not install or remove skills; you choose the skills at setup, and the profile
changes how strictly the workflow uses them.

| Skill | Started | Use when | Reads which controls | Produces | Connected to |
|---|---|---|---|---|---|
| `setup-workspace` | by hand | Once per project, to install the kit | asks for the profile | the installed pieces, `.claude/workflow.json` | installs all the others |
| `workspace-router` | by Claude | Start of work, to pick the skill or document for a task | `planning.gates` (in its standing rules) | a decision about which skill to read | routes to every skill below |
| `goal-first-planner` | by Claude | Starting a feature or project | `planning.gates` (it writes a `TDD: yes or no` line; the test-discipline rule reads that line together with `tests.tdd`) | `PLAN.md` | the `reviewer` reads `PLAN.md` |
| `write-project-overview` | by Claude | No `AGENTS.md` yet, or a stale one | none | `AGENTS.md` (create) or approved line edits (refresh) | runs `overview-check.mjs`; feeds `docs-fresh` |
| `changelog-bump` | by Claude | A commit needs a changelog entry, or a release bumps the version | none | `CHANGELOG.md`, version files | called by the commit hook and the release workflow |
| `pr-description` | by Claude | Writing the pull request text | none | text only | reads the diff and `PLAN.md` |
| `readable-fix-plan` | by Claude | Turning review findings or a bug list into one plan | none | a verified, clickable fix plan | takes findings from the reviewer or a harsh review |
| `figma-sync` | by Claude | UI changes are pending, or you ask to align the design | none | frames in Figma, `FIGMA-SYNC.md` | fed by the `ui-change-flagging` rule; runs before the commit |
| `ultra-code-quality-review` | by hand | You want a deliberately harsh maintainability review | none | a structural review | separate from the review gate; it does not leave a review record |

The `reviewer` is a **subagent**, not a skill: a file in `.claude/agents/` that the assistant starts as a fresh
reader at step 4. It is tuned by `review.mode`.

How they connect:

```text
   setup-workspace --installs--> everything

   workspace-router
      |--routes--> goal-first-planner --writes--> PLAN.md --read by--> reviewer --writes--> review record
      |                                                                                         |
      |                                                                               read by check-review-gate
      |                                                                               (pre-push hook)
      |--routes--> write-project-overview --writes--> AGENTS.md <--checked by-- overview-check.mjs
      |--routes--> figma-sync <--rows from-- ui-change-flagging rule
      |--routes--> readable-fix-plan <--findings from-- reviewer / ultra code quality review
      |--routes--> pr-description (reads the diff + PLAN.md)
      `--routes--> changelog-bump <--called by-- pre-commit hook, release_bump workflow
```
