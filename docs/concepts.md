# What the kit is, why it exists and how it fits together

Sections 1 to 4 of the former README: what the kit is and is not, why it was built, what it is based on, and the kit at a glance. Back to the [README](../README.md).

## 1. What it is, and what it is not

**It is** an npm package that puts a set of plain files into a project, plus an installer that places each piece
where your AI tool reads it:

- **Rules**: short instructions the assistant follows on every change (readable code, tidy repository, docs
  kept fresh, a commit gate, honest verification, test discipline).
- **Skills**: longer procedures the assistant uses for one kind of task (plan a feature, write the project
  overview, write a pull request description, keep a changelog, sync a design, update the kit itself).
- **Templates**: starting files (`AGENTS.md` overview, `PLAN.md`, `REVIEW.md`, `CHANGELOG.md`, hook wrappers,
  a release workflow, the workflow profile).
- **Scripts and hooks**: small Node programs that check things without Claude (skill lint, `@` import
  resolver, doc-size report, stale-overview finder, test-edit guard, review gate, docs-fresh check).
- **A workflow profile**: one file, `.claude/workflow.json`, that says how strict all of the above is.
- **An installer, an uninstaller and a catalog**: `init` copies the kit into the project, `apply` installs the
  pieces you chose and records what it did, `uninstall` removes exactly that again, and `catalog/options.json` holds
  the one-line explanation of every option that the setup questionnaire shows.

**It is not** a library, a framework or a service. Nothing runs inside your app. It does not call Claude in CI,
it does not need an API key, the installer makes no network calls, and most of its rules are advice the
assistant follows, not locks. The few hard stops (a failing commit hook, a blocked push) are listed in
[section 7](profile-flows.md#7-solo-team-and-org-what-turns-on-and-off).

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
| Every project reinvents the workflow | One kit, installed with one `npx` command and a setup prompt, upgraded by installing a newer version |
| A new tool would overwrite what the project already has | Kit skills get a `wk-` prefix, edits to your files are marked blocks, and anything that exists and differs is skipped and reported |
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
**[`docs/playbook-mapping.md`](playbook-mapping.md)**, which also scores 27 playbook practices: Covered 6,
Partly 12, Differs by decision 3, Out of scope by decision 5, kit addition 1, each with how it was checked.

## 4. The kit at a glance

The kit is an npm package and a git repository. `init` copies it into the project's own `.claude/workspace-kit/`
folder; the setup prompt and the `apply` program then put each piece you chose where it is used.

```text
 THE PACKAGE (this repository)                      YOUR PROJECT
 -----------------------------                      ------------
 npx ... init  ---copies everything--->             .claude/workspace-kit/     the kit's own folder
                                                          |   setup prompt + `apply`: only what you choose
                                                          v
 rules/        8 short rules          --apply-->    a marked block in CLAUDE.md (Claude Code alone)
                                                    or in AGENTS.md (any other tool)
 skills/       11 skills              --apply-->    .claude/skills/wk-<name>/   (or .agents/skills/, .cline/skills/)
 templates/    AGENTS.md, PLAN.md,    --apply-->    AGENTS.md, PLAN.md, REVIEW.md, CHANGELOG.md (only if missing),
               REVIEW.md, agents/,                  .claude/agents/reviewer.md, .claude/workflow.json,
               workflow.json, hooks/                a marked block in your git hooks (pre-commit, pre-push)
 templates/scripts/  the checks       --apply-->    scripts/*.mjs
 catalog/      every option, explained (read by the questionnaire)
 bin/ lib/     the installer: init, apply, uninstall (copied too, so setup needs no network)
 docs/ adapters/ stacks/                            reference only; they stay in .claude/workspace-kit/
```

In a project the skills are named `wk-<name>` so they cannot clash with skills the project already has. The rest
of this README uses the plain names.

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
