# Workspace kit

A portable set of working rules, skills, templates and checks that make an AI coding assistant (Claude Code
first, other tools through adapters) work the way a careful engineer works: plan before building, keep the
code and the docs true, prove what was done, get a second reader on the change, and ship with a clean history.
Copy it into any project, run one setup skill, and choose how strict it should be: **solo**, **team** or **org**.

It grew out of day-to-day work with an AI assistant, was made independent of any language or framework, and
was then aligned with Anthropic's
[AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook).

## Contents

1. [What it is, and what it is not](#1-what-it-is-and-what-it-is-not)
2. [Why it was built](#2-why-it-was-built)
3. [What it is based on](#3-what-it-is-based-on)
4. [The kit at a glance](#4-the-kit-at-a-glance)
5. [The workflow, step by step](#5-the-workflow-step-by-step)
6. [The skills and how they connect](#6-the-skills-and-how-they-connect)
7. [Solo, team and org: what turns on and off](#7-solo-team-and-org-what-turns-on-and-off)
8. [Install and use](#8-install-and-use)
9. [Keeping the kit up to date](#9-keeping-the-kit-up-to-date)
10. [Design principles](#10-design-principles)
11. [How it was checked, and what is not proven](#11-how-it-was-checked-and-what-is-not-proven)
12. [What is not in the kit](#12-what-is-not-in-the-kit)
13. [Repository layout](#13-repository-layout)
14. [Glossary](#14-glossary)
15. [Credits](#15-credits)

---

## 1. What it is, and what it is not

**It is** a folder of plain files that you copy into a project:

- **Rules**: short instructions the assistant follows on every change (readable code, tidy repository, docs
  kept fresh, a commit gate, honest verification, test discipline).
- **Skills**: longer procedures the assistant uses for one kind of task (plan a feature, write the project
  overview, write a pull request description, keep a changelog, sync a design, update the kit itself).
- **Templates**: starting files (`AGENTS.md` overview, `PLAN.md`, `REVIEW.md`, `CHANGELOG.md`, hook wrappers,
  a release workflow, the workflow profile).
- **Scripts and hooks**: small Node programs that check things without Claude (skill lint, `@` import
  resolver, doc-size report, stale-overview finder, test-edit guard, review gate, docs-fresh check).
- **A workflow profile**: one file, `.claude/workflow.json`, that says how strict all of the above is.

**It is not** a library, a framework or a service. Nothing runs inside your app. It does not call Claude in CI,
it does not need an API key, and most of its rules are advice the assistant follows, not locks. The few hard
stops (a failing commit hook, a blocked push) are listed in [section 7](#7-solo-team-and-org-what-turns-on-and-off).

## 2. Why it was built

Working with an AI assistant on a real project goes wrong in predictable ways:

| What goes wrong | What the kit does about it |
|---|---|
| Code is written before anyone agreed what it should do | A planner agrees a goal, success criteria and non-goals first (the Intent Anchor), then works in small buckets |
| The docs describe a project that no longer exists | A docs-fresh rule, a commit-time warning, and a script that finds stale lines in the overview |
| "It works" is said about something only read, never run | A verification rule: say what was run, show the output, never call read code "tested" |
| A bug is "fixed" by weakening the test | Test discipline: a failing test first, a hook that blocks edits to existing tests during a fix |
| The author is the only reader of a change | A reviewer subagent that reads the change cold, against the plan and a checklist |
| The assistant's instructions grow without anyone noticing | A skill lint, an `@` import check, and a size report for the always-loaded files |
| Every project reinvents the workflow | One kit, installed by one skill, updated in both directions through git |
| One-size-fits-all strictness is too heavy for one person and too light for many | A profile (`solo`, `team`, `org`) turns each control on or off |

The workflow was first built and used day to day, then generalized into this kit so any project can use it, and
later aligned with the playbook below.

## 3. What it is based on

The kit follows Louis Claxton's **[The AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)**
(Anthropic, 2026-08-21), which describes six plays: Plan, Design, Build, Test, Deploy, Maintain. The kit takes
the parts that fit a repository you control and leaves out the ones that need infrastructure.

| Playbook idea | Where it is in the kit |
|---|---|
| Capture the intent in the repository before building | `goal-first-planner` and `templates/PLAN.md` |
| Nothing is implemented without an accepted plan | `planning.gates` (a rule, with plan mode as an optional hard stop) |
| A short CLAUDE.md with commands and conventions | `templates/AGENTS.md`, `write-project-overview`, the doc-size report |
| Skills as institutional knowledge, tested for triggering | `skills/`, `triggers.json` fixtures, the skill lint, the opt-in trigger runner |
| Hooks as guardrails | The test-edit guard, the docs-fresh check, the commit and push hooks |
| A feedback loop: tests, build, pasted output | `verification` and `test-discipline` rules |
| A bug fix starts with a failing test; a hook protects tests | `test-discipline` and `test-edit-guard.mjs` |
| An independent review with a `REVIEW.md` | The `reviewer` subagent, `templates/REVIEW.md`, the review gate |
| One source of truth per artifact | The `docs-fresh` rule and the Sources of truth list in the overview |

Where the kit differs on purpose (overview size, test-first for new logic, one `PLAN.md`, a review record that is
an attestation, strictness by profile, and what is left out) is written down in
**[`docs/playbook-mapping.md`](docs/playbook-mapping.md)**, which also scores 27 playbook practices: Covered 6,
Partly 12, Differs by decision 3, Out of scope by decision 5, kit addition 1, each with how it was checked.

## 4. The kit at a glance

The kit lives in one repository. A project gets a copy, and the setup skill puts each piece where it is used.

```text
 KIT REPOSITORY (this repo)                        YOUR PROJECT
 --------------------------                        ------------
 rules/        8 short rules          --setup-->   CLAUDE.md (rules are imported or pasted here)
 skills/       10 skills              --setup-->   .claude/skills/<name>/
 templates/    AGENTS.md, PLAN.md,    --setup-->   AGENTS.md, PLAN.md, REVIEW.md, CHANGELOG.md,
               REVIEW.md, agents/,                 .claude/agents/reviewer.md, .claude/workflow.json
               workflow.json, hooks/               git hooks (pre-commit, pre-push)
 templates/scripts/  checks + tests   --setup-->   scripts/*.mjs
 docs/ adapters/ stacks/                           (reference only; kept in .claude/workspace-kit/)
        ^                                                    |
        |   update-workspace-kit: PULL (kit -> project)      |
        +---------------  PUSH (project -> kit)  <-----------+
```

What reads what, inside a project:

```text
   .claude/workflow.json   (profile: solo | team | org, plus overrides; resolved by scripts/workflow-config.mjs)
        |
        |  each piece reads the control it needs:
        |
        +-- planning.gates ........... the planner skill, the router skill, the planning-gate line in CLAUDE.md
        +-- tests.tdd, tests.guard ... the test-discipline rule; test-edit-guard.mjs (tests.guard)
        +-- docs.check ............... check-docs-fresh.mjs, run by the commit hook
        +-- review.mode .............. the commit-gate rule (the assistant runs the reviewer);
        |                              check-review-gate.mjs, run by the pre-push hook
        +-- docs.sizeWarnChars ....... doc-size.mjs
        +-- static.checks ............ check-config.mjs (skill lint, @ imports)
        `-- claude.runChecks ......... run-claude-checks.mjs (opt-in)

   The files the workflow keeps in step:
        AGENTS.md (overview) <---- docs-fresh rule, write-project-overview, overview-check.mjs
        PLAN.md ................. written by the planner, read by the reviewer, updated with the work
        .claude/reviews/<tree>.md  written after a review, read by the pre-push hook
```

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
   6 PUSH ......... pre-push hook: no direct push to main or master; review gate
      |             tuned by: review.mode
      v
   7 PULL REQUEST . pr-description writes the text; CI runs; merge; the release workflow bumps the version
      |
      v
   8 KEEP IT TRUE . write-project-overview (refresh), check-config, update-workspace-kit
```

### Step 0: install (once per project)

```text
   copy the kit to .claude/workspace-kit/
      |
      v
   prompt: "Read .claude/workspace-kit/skills/setup-workspace/SKILL.md and follow it"
      |
      v
   look at the project, read-only (stack, branch, hooks, CI, commands, existing assistant files)
      |
      v
   ask ONE round, at most four questions (tools, pieces, changelog setup, wrong detections)
      |
      v
   install, never overwriting; append or merge and show the change
      +--> skills ............ .claude/skills/<name>/
      +--> rules ............. CLAUDE.md (or one file per rule for Cursor)
      +--> templates ......... AGENTS.md, PLAN.md, REVIEW.md, CHANGELOG.md (only if missing)
      +--> workflow profile .. .claude/workflow.json (you choose solo, team or org)
      +--> scripts + hooks ... scripts/*.mjs, pre-commit, pre-push (only if chosen)
      +--> plan mode ......... offered for team and org
      |
      v
   verify (skills in place, scripts run, no leftover placeholders) --> summary --> no commit
```

Skills involved: `setup-workspace` (started by hand), then `write-project-overview` when `AGENTS.md` does not exist.

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
      +--> is it the protected branch (the one named in the hook: main or master)? --yes--> BLOCKED:
      |      push a branch, open a pull request
      |
      +--> review gate on the tip of the ref (review.mode)
             off .......... silent
             advisory ..... a reminder if there is no clean record; the push goes ahead
             required ..... BLOCKED if there is no record, or the record has blocking findings
      v
   pushed   (the hook fails open: no git, a crash, or no node on the PATH never stops a push)
```

Assistants commit when asked and never push; a person pushes.

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

   the kit has improvements, or the project made one?
      |
      v
   update-workspace-kit: PULL (kit -> project) or PUSH (project -> kit), always asks first
```

## 6. The skills and how they connect

Ten skills. **Started by hand** means only you can start it (`/name`); otherwise Claude may pick it from its
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
| `update-workspace-kit` | by Claude | A change is reusable, or you say "pull the latest kit" | none | kit changes on a branch, or a refreshed snapshot | talks to the kit repository |

The `reviewer` is a **subagent**, not a skill: a file in `.claude/agents/` that the assistant starts as a fresh
reader at step 4. It is tuned by `review.mode`.

How they connect:

```text
   setup-workspace --installs--> everything --kept in step by--> update-workspace-kit <--> KIT REPOSITORY

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

## 7. Solo, team and org: what turns on and off

One file sets it: `.claude/workflow.json`.

```json
{ "profile": "solo", "overrides": { "docs.check": "strict" } }
```

| Profile | For | In one line |
|---|---|---|
| `solo` (default) | One owner who reads every diff and approves every step | Light: advice and warnings; the Intent Anchor is agreed before non-trivial work; nothing blocks except the hooks you installed |
| `team` | A few developers on a shared repository | Adds the test-edit guard and test-first for new logic |
| `org` | Many developers, policies that must hold | Strict: the docs check blocks a commit, a clean review record is required to push, success measurements are recorded |

Pick the smallest profile that fits. A control that blocks costs time every day; turn one on when the risk it
removes is real, not because it exists. Skills are installed or not at setup; the profile changes how strictly
the workflow requires them.

### What each step does in each profile

Legend: **[off]** not applied. **[soft]** a rule or a warning; the assistant follows it, nothing stops you.
**[HARD]** something blocks (a hook exit code or a tool). It exists only where the hook is installed, and a person
can bypass it on purpose (`--no-verify`, `REVIEW_MODE=off`).

```text
 SOLO (default)
   1 plan     [soft]  non-trivial work needs an approved Intent Anchor in PLAN.md (the planner runs: interview,
                      Intent Anchor, buckets, checkpoints); routine work is exempt; plan mode is not offered
   2 build    rules always on; test-edit guard [off]; new-logic test-first only for a bucket marked TDD: yes
   3 verify   [soft]  show the real output
   4 review   [soft]  advisory: the assistant runs the reviewer before a commit
   5 commit   checks + changelog [HARD, if you installed the commit hook]; docs-fresh [soft] warning
   6 push     protected branch [HARD, if you installed the push hook]; review gate [soft] reminder
   7 pr       pr-description when you ask

 TEAM
   1 plan     [soft]  non-trivial work needs an approved Intent Anchor in PLAN.md; routine work is exempt;
                      plan mode (a real stop in the terminal) is offered at setup
   2 build    rules always on; test-edit guard [HARD in fix mode]; new logic test-first [soft]
   3 verify   [soft]
   4 review   [soft]  advisory
   5 commit   checks + changelog [HARD]; docs-fresh [soft] warning
   6 push     protected branch [HARD]; review gate [soft] reminder
   7 pr       pr-description when you ask

 ORG
   1 plan     [soft]  the Intent Anchor AND success measurements before non-trivial code; plan mode offered
   2 build    rules always on; test-edit guard [HARD in fix mode]; new logic test-first [soft]
   3 verify   [soft]
   4 review   [soft]  the assistant must run the reviewer and record the result
   5 commit   checks + changelog [HARD]; docs-fresh [HARD]: the commit is blocked when source changed
              but AGENTS.md did not
   6 push     protected branch [HARD]; review gate [HARD]: blocked without a clean review record
   7 pr       pr-description when you ask
```

The same, as a table:

| Step or piece | solo | team | org |
|---|---|---|---|
| Planning before code (`planning.gates`) | `anchor`: soft rule | `anchor`: soft rule | `full`: soft rule + measurements |
| Always-on rules (readable code, tidy repo, docs fresh, verification) | on | on | on |
| Test-edit guard in fix mode (`tests.guard`) | off | on | on |
| Bug fix starts with a failing test | rule | rule | rule |
| New logic test-first (`tests.tdd`) | `bugs`: only when a bucket says `TDD: yes` | `on`: rule | `on`: rule |
| Reviewer before a commit (`review.mode`) | `advisory` | `advisory` | `required` |
| Push blocked without a clean review record | no (reminder) | no (reminder) | yes |
| Docs-fresh check at commit (`docs.check`) | `warn` | `warn` | `strict` (blocks) |
| Doc-size warning (`docs.sizeWarnChars`) | 40,000 characters | 40,000 | 40,000 |
| Static checks: skill lint, `@` imports (`static.checks`) | on | on | on |
| Checks that run `claude -p` (`claude.runChecks`) | off (opt-in) | off (opt-in) | off (opt-in) |
| Plan mode as the session default | not offered | offered | offered |
| Commit hook, push hook, changelog | your install choice, the same in every profile | | |

### Changing it

```text
   edit .claude/workflow.json   "profile": "solo" | "team" | "org"
   one control               "overrides": { "docs.check": "strict" }
   one command only          DOCS_CHECK=strict git commit ...      (each control has an environment variable)
   whole profile, one command WORKFLOW_PROFILE=org <command>
   see the result            node scripts/workflow-config.mjs      (prints every control and where it came from)
```

Precedence: environment variable, then `overrides`, then the profile default. A missing or broken file means
`solo`, with a warning. Full table of the controls, with the reason for each profile's value:
[`docs/workflow-profiles.md`](docs/workflow-profiles.md).

### Hard stops, in one place

| Stop | When it blocks |
|---|---|
| Commit hook: lint, type check, tests | Always, if you installed the hook and a check fails |
| Docs-fresh check | `docs.check` is `strict` (org by default) |
| Test-edit guard | `tests.guard` is `on` (team and org), the PreToolUse entry is in `.claude/settings.json`, and fix mode was started with `start`; it blocks edits made by Claude (Edit, Write, MultiEdit) |
| Pre-push: protected branch | Always, if you installed the push hook |
| Pre-push: review gate | `review.mode` is `required` (org by default) |

Everything else is a rule or a warning. A hook that cannot run (no git, a crash, no `node`) allows the action
and says so; a broken profile file falls back to `solo` with a warning.

## 8. Install and use

**Fast way (one step plus one prompt):**
1. Copy the **whole kit** into the project as ONE folder: `.claude/workspace-kit/` (it is not loaded as
   skills, so it does not clutter the skill list).
2. Prompt the assistant: *"Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it."*

It finds the kit in that folder, looks at the project, asks four questions, then installs the pieces you choose
([step 0](#step-0-install-once-per-project)). Afterwards keep `.claude/workspace-kit/` as the source for
updates, or delete it. You can also give the kit's path in the prompt and skip the copy. Copying only the
`setup-workspace` folder is not enough: without the kit it has nothing to install.

**Why not copy the kit's folders straight into `.claude/`:** Claude Code loads skills only from
`.claude/skills/<name>/`, and does not load `rules/`, `templates/` or `adapters/` from there. One subfolder
keeps the kit together; the setup step puts each piece where it is actually used.

**By hand:** pick pieces from the tables, follow `adapters/<your tool>.md` for the locations, fill the `<...>`
placeholders in the templates, and wire the hooks if you want the changelog and the gates.

**Tools:** Claude Code first. `adapters/` says where each piece goes for Claude Code, Cline, Cursor and tools
that read `AGENTS.md`. The subagent, the plan-mode setting and `.claude/settings.json` hooks are Claude Code
features.

### Day to day: the commands

| Command | What it does | Needs Claude? |
|---|---|---|
| `node scripts/workflow-config.mjs` | Prints the resolved profile and where each control came from | No |
| `node scripts/check-config.mjs` | Skill lint, `@` import check, doc-size report | No |
| `node scripts/overview-check.mjs` | Lists lines of `AGENTS.md` that no longer match the project | No |
| `node scripts/doc-size.mjs` | Size of the always-loaded files (measures and warns, never trims) | No |
| `node scripts/check-review-gate.mjs [--staged]` | Is there a clean review record for these contents? | No |
| `node scripts/check-review-gate.mjs record --blocking <n> ...` | Records a finished review | No |
| `node scripts/test-edit-guard.mjs start / lock / stop / status` | Fix mode for the test-edit guard | No |
| `node scripts/run-claude-checks.mjs --yes` | Asks `claude -p` about `@` imports and skill triggers | **Yes** (opt-in, uses your usage) |

## 9. Keeping the kit up to date

This kit is a **git repository** (`https://github.com/Jakub-Owczarzak/workspace-kit`), so no project depends on
one machine's folder. The `update-workspace-kit` skill moves changes both ways, and always asks first:

- **Push** (project -> kit): it checks a piece is reusable, removes project facts, shows the plan, asks,
  writes it to a branch of the kit, runs the piece's test, and asks before pushing or opening a pull request.
- **Pull** (kit -> project): "pull the latest kit" refreshes the project's `.claude/workspace-kit/` snapshot,
  offers to update the installed skills that are behind, and offers kit pieces the project does not have yet,
  without overwriting project facts. The snapshot records the kit commit it came from in
  `.claude/workspace-kit/.kit-version`, so drift can be measured.

Install it like any other skill (copy `skills/update-workspace-kit/` to `.claude/skills/` and fill its Settings
table: repository URL, optional local clone, the project's copy of the kit, kit-origin and project-only
pieces). Keep project facts out of the kit.

## 10. Design principles

- **Rules are always on, skills are on demand.** Rules are short and apply to every change; a skill is a
  longer procedure used for one kind of task.
- **Procedure and data are separate.** A skill holds the method and no project facts; the project keeps its
  own data in a file the skill reads (`figma-sync` and `FIGMA-SYNC.md`, `changelog-bump` and `CHANGELOG.md`).
- **Plain markdown first.** Nothing depends on one tool. The adapters only say where files go.
- **Ask before changing, never overwrite.** Installing is additive and shows what it will change.
- **Report honestly.** Verification statements say what was run and what was not.
- **Strictness is a setting.** The profile turns controls on or off per project; the default is light.
- **Measure, do not trim.** The size report shows the cost of the always-loaded files and never cuts them.
- **Fail open.** A check that cannot run allows the action and says so; a guard that can wedge a session costs
  more than it protects.
- **Local only.** No CI calls to Claude, no API key, no GitHub calls from the kit's scripts.

## 11. How it was checked, and what is not proven

- **Tests:** `node --test templates/scripts/*.test.mjs skills/changelog-bump/scripts/*.test.mjs` passes
  (218 tests on 2026-11-09, 22 of them for `changelog-bump`). None calls Claude. They include real runs in
  throw-away git repositories and a run of the pre-push template with `sh`.
- **Skill lint:** `node templates/scripts/check-config.mjs --root . --skills-dir skills` reports 10 skills,
  0 errors, 0 warnings. This checks structure only; it does not prove a skill triggers.
- **Model-reported checks (`claude -p`, with the owner's approval, one sample each):** trigger fixtures on an
  installed copy of the kit (38 pass, 0 fail, 4 unclear), the overview skill (7 of 7), the planning gate (5 of 5
  expected answers, re-run after `solo` moved to `anchor`).
- **Real use:** one real project has had a pull of the kit, at commit `f76d0a6` (applied in its working tree,
  not committed there); the test-edit guard blocked a real edit there. The overview skill, the review gate and
  the planner changes came after that pull and are not in that project yet. No other project has been updated.
- **Reviews:** five reviews by fresh subagents given the `reviewer` instructions (not the registered agent): the
  review gate (twice), the planner changes, the mapping page and this README. All the runs above were made on
  2026-11-09; the numbers are from that day and will change as the kit does.
- **Not yet run:** plan mode, a real `git push` through the pre-push hook, `setup-workspace` with the newest
  pieces, and a pull into a project that already has its own overview and skills.

The status of every playbook practice, and how it was checked, is in
[`docs/playbook-mapping.md`](docs/playbook-mapping.md). Known limits: a review record is an attestation (the
assistant that wrote the change can write it); the reviewer has Bash and is told not to change anything, which is
instructions, not a sandbox; the review gate is per machine; and the VS Code extension does not read a project's
default plan mode, per the Claude Code docs.

## 12. What is not in the kit

- The Expo/EAS skills themselves (they come from the Claude Code plugin or `expo/skills`), app-specific
  rules and any framework code review. The Expo routing rows and rule ARE here, as the stack pack in
  `stacks/expo-react-native/`. Add your project's own skills to the router's project table.
- Personal settings (`settings.local.json`) and secrets.
- By decision: Claude in CI (evals, pull request review), managed settings, worktrees and parallel sessions,
  Maintain-stage plays, and reading GitHub branch protection (see `docs/playbook-mapping.md`).
- `figma-sync` needs the Figma connector and, for first use, a copy of the design file.

## 13. Repository layout

```text
 workspace-kit/
   README.md                 this file
   rules/                    8 always-on rules: readable-code, repo-tidiness, docs-fresh, commit-gate,
                             verification, test-discipline, skill-routing, ui-change-flagging
   skills/                   10 skills, each with SKILL.md (and triggers.json for the model-invocable ones)
   templates/
     AGENTS.md CLAUDE.md PLAN.md REVIEW.md BACKLOG.md FIGMA-SYNC.md CHANGELOG.md workflow.json
     agents/reviewer.md      the reviewer subagent
     hooks/                  pre-commit and pre-push wrappers
     workflows/              release_bump.yaml
     scripts/                the checks, the profile resolver and their tests
   docs/                     workflow-profiles, config-checks, test-discipline, project-overview,
                             review-gate, playbook-mapping
   adapters/                 where each piece goes: Claude Code, Cline, Cursor, AGENTS.md readers
   stacks/expo-react-native/ routing rows and an always-on rule for one framework (optional)
```

| Folder | What | Always on? |
|---|---|---|
| `rules/` | Short rules every session follows | Yes (put in the tool's instruction file) |
| `skills/` | Procedures used on demand | No (used when the task matches) |
| `templates/` | Starting files and scripts | Copied once, then edited |
| `adapters/` | Where each piece goes per tool | Reference |
| `docs/` | Reference docs for the profile, the checks, the test policy, the overview skill, the review gate and the playbook mapping | Read when choosing how strict a project's workflow should be |
| `stacks/` | One folder per framework, with no project facts | Optional |

## 14. Glossary

| Term | Meaning |
|---|---|
| **Intent Anchor** | The short agreed statement of goal, success criteria, non-goals, constraints, assumptions and risks that every later step is checked against |
| **Bucket** | A small piece of work that produces something visible or testable and ends at a checkpoint |
| **Checkpoint** | The stop after a bucket: what was done, how it was verified, a drift check, decisions logged |
| **Profile** | `solo`, `team` or `org`: the preset of strictness in `.claude/workflow.json` |
| **Control** | One setting the profile sets (for example `review.mode`); an override or an environment variable can change it |
| **Rule** | A short instruction always loaded into the assistant's context |
| **Skill** | A longer procedure loaded when its task comes up |
| **Subagent** | A helper the assistant starts with a fresh context, here the `reviewer` |
| **Review record** | A small file in `.claude/reviews/` that says which exact contents (a git tree) were reviewed and how many blocking findings remain |
| **Fix mode** | The period during a bug fix when the test-edit guard blocks edits to existing test files |
| **Plan mode** | A Claude Code mode where Claude cannot edit files until you accept a plan |
| **Soft rule / hard stop** | A soft rule is advice the assistant follows; a hard stop is something that blocks (a hook exit code) |
| **Stack pack** | Routing rows and a rule for one framework, kept apart from the general kit |

## 15. Credits

- **The AI-native SDLC playbook**, Louis Claxton, Anthropic, 2026-08-21:
  <https://claude.com/resources/articles/the-ai-native-sdlc-playbook>. The kit's structure follows its plays; the
  quotes on `docs/playbook-mapping.md` are short and attributed.
- Built with Claude Code.
