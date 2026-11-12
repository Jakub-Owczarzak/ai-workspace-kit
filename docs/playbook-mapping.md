# The AI-native SDLC playbook and this kit

The kit follows Louis Claxton's "The AI-native SDLC playbook" (Anthropic, 2026-08-21,
claude.com/resources/articles/the-ai-native-sdlc-playbook). This page says, practice by practice, what the kit
does about it, how that was checked, and where the kit differs on purpose. It is also the kit's scorecard: re-check
the status column after a change to the kit.

**Scorecard (2026-11-09, 27 practices):** Covered 6, Partly 12, Differs by decision 3, Out of scope by decision 5,
kit addition 1.

A row's status is the weakest honest word for it: if one step of a practice differs, the row is not "Covered".

**Status words**
- **Covered**: the kit has a piece that does this.
- **Partly**: the kit does part of it, or does it as advice where the playbook has a hard stop.
- **Differs by decision**: the kit does it another way, chosen on purpose (see "Knowing differences").
- **Out of scope by decision**: left out on purpose.

**How it was checked**
- *unit tests*: `node --test`, no Claude involved.
- *live run*: the piece ran in a real project or a throw-away git repository.
- *claude -p*: the opt-in runner asked the model; the answer is model-reported and one sample.
- *review*: a fresh subagent given the `reviewer` instructions read the change (not the registered agent).
- *read only*: the piece is text (a rule or a template); nothing runs, so nothing was tested.
- *not tried*: nobody has run it.

## Plan and Design

| Playbook practice | In this kit | Status | How it was checked |
|---|---|---|---|
| Capture the intent in the repository: problem, outcome, users, constraints, open questions | `templates/PLAN.md` (the Intent Anchor), `skills/goal-first-planner/SKILL.md` | Covered (one file, other field names) | claude -p trigger run on an installed copy; planning-gate check, 5 cases, one sample each |
| A person reviews and corrects the intent before it is committed | The planner asks the user to approve the Intent Anchor; control `planning.gates` | Partly: a rule the assistant follows, not a block | claude -p planning-gate check; plan mode not tried |
| Measure whether capturing intent got faster | The "Success measurements" field, needed when `planning.gates` is `full` | Partly: the field exists, nothing measures it | read only |
| Requirements and design decisions recorded next to the intent (`spec.md`) | The decision log and the key decisions of each bucket in `PLAN.md` | Differs by decision: one `PLAN.md`, no separate spec file | read only |
| A human makes the design call | The planner asks the user to approve each key decision | Covered | read only |

## Build

| Playbook practice | In this kit | Status | How it was checked |
|---|---|---|---|
| Plan mode as the default start; nothing is implemented without an accepted plan | `planning.gates`, the planning-gate line in `templates/CLAUDE.md`, and setup offering plan mode for `team` and `org` (`docs/workflow-profiles.md`) | Partly: a soft rule; plan mode is optional, and per the Claude Code docs the VS Code extension does not read a project's default mode | claude -p planning-gate check; plan mode not tried |
| Update the plan in the same commit when the work departs from it | The planner's Persistence section, `rules/docs-fresh.md` | Partly: a rule; the playbook also suggests a hook, which is not built | read only |
| Auto mode for routine work | The routine-work exemption in the planning gate | Partly: the exemption exists; the kit does not set a permission mode | read only |
| One source of truth per artifact; everything else links to it | `rules/docs-fresh.md`, the "Sources of truth" list in `templates/AGENTS.md` | Partly: covered for the repository; not covered: writing results back to an outside system | read only |
| A short CLAUDE.md: commands, conventions, things Claude gets wrong | `templates/AGENTS.md`, `templates/CLAUDE.md`, `skills/write-project-overview/SKILL.md`, `templates/scripts/overview-check.mjs`, `templates/scripts/doc-size.mjs` | Differs by decision on size (see below) | unit tests; a scratch project; a refresh of an existing overview; claude -p trigger run |
| Skills as institutional knowledge, with a test that they trigger | `skills/`, the `triggers.json` in each model-invocable skill (8 of the 10; the two hand-started skills have none by design), `templates/scripts/check-skills.mjs`, `templates/scripts/run-claude-checks.mjs` | Covered | unit tests; lint of the 10 kit skills; claude -p trigger runs |
| Hooks as build-time guardrails; a block explains itself | `templates/scripts/test-edit-guard.mjs`, `templates/scripts/check-docs-fresh.mjs`, `templates/hooks/pre-commit` | Covered | unit tests; the guard blocked a real edit in a real project |
| Subagents checked in under `.claude/agents/` | `templates/agents/reviewer.md` | Partly: one subagent, the reviewer | review (below) |
| Parallel sessions and worktrees | none | Out of scope by decision | not tried |

## Test

| Playbook practice | In this kit | Status | How it was checked |
|---|---|---|---|
| A feedback loop: tests, build, lint; paste the output | `rules/verification.md`, `rules/test-discipline.md`, `rules/commit-gate.md` | Covered | read only (the rules are text); a real project's pre-commit hook runs lint-staged, type check and tests (read, not re-run) |
| A bug fix starts with a failing test and never edits it; a hook blocks edits to tests | `rules/test-discipline.md`, `templates/scripts/test-edit-guard.mjs` (control `tests.guard`) | Partly: the failing-test-first rule and the edit-blocking hook exist; the failing test is not committed first | unit tests; a live block in a real project |
| Test-first for new logic | Control `tests.tdd`, and `TDD: yes` in a bucket | A kit addition: the playbook asks for it only for bug fixes | read only |
| Evals in CI when CLAUDE.md, skills or hooks change | none | Out of scope by decision (no Claude in CI) | not tried |
| Regression-test the configuration itself, here run locally | `templates/scripts/check-config.mjs` (skill lint, `@` imports, doc size) and the opt-in `templates/scripts/run-claude-checks.mjs` | Partly: the static checks always run; the Claude-run checks are opt-in and model-reported | unit tests; one claude -p run on an installed copy |

## Deploy

| Playbook practice | In this kit | Status | How it was checked |
|---|---|---|---|
| An AI review of every change, findings ranked by severity | `templates/agents/reviewer.md`, `templates/REVIEW.md`, `docs/review-gate.md` | Partly: it runs locally before a commit, not on GitHub pull requests | five reviews by fresh subagents (two on the review gate, one each on the planner changes, this page and the README), one sample each |
| `REVIEW.md` defines what blocks and what does not, what to skip, and a nit cap | `templates/REVIEW.md` | Covered | read only; the reviews above used it as their checklist |
| The agent that wrote the code cannot approve it | `templates/scripts/check-review-gate.mjs` | Differs by decision: the record is an attestation the same assistant can write | unit tests |
| Branch protection with a human approval | none; `templates/hooks/pre-push` blocks direct pushes to the protected branch on this machine | Out of scope by decision: GitHub offers no protection for private repositories on the free plan, and the kit does not read it | not tried |
| Hooks as approval gates | `templates/hooks/pre-push` and `check-review-gate.mjs` (control `review.mode`) | Partly: local, and fails open | unit tests, including the hook template run with `sh`; real pushes of factory branches went through it on GitHub and GitLab scratch repos (2026-11-11, `docs/factory-rehearsal.md`); a refusal of the protected branch in a real push is covered by the tests and by `factory-guard push-check`, not by a real push |
| Managed settings for an enterprise | none | Out of scope by decision | not tried |
| CI/CD and deployment | `templates/workflows/release_bump.yaml`, `skills/changelog-bump/SKILL.md` | Partly: a version bump and changelog only, no deploy pipeline | unit tests (changelog); a real project's history shows release pull requests from `release/next` (v0.1.2) |

## Maintain

| Playbook practice | In this kit | Status | How it was checked |
|---|---|---|---|
| Close the loop: recurring codebase scans, alerts turned into intent, Claude on call | none | Out of scope by decision | not tried |

## Knowing differences

1. **Size of the overview.** The playbook says: "Keep it under a page, because Claude reads all of it at the
   start of a session." The kit only warns above 40,000 characters (`docs.sizeWarnChars`) and never trims, and
   a real overview of 81,749 characters was far over that and was kept, not trimmed: the kit
   gives a generator and a measurement, not a cut.
2. **Test-first for new logic** is the kit's addition (`tests.tdd`); the playbook requires it for bug fixes.
3. **The failing test is not committed first.** The playbook says "Commit that test"; the kit's commit hook
   runs the tests, so a failing test cannot be committed. The guard's `lock` command protects it.
4. **One `PLAN.md`** instead of an `intent/` folder with files per change.
5. **Approval.** The playbook: "the agent that wrote the code has no way to approve it". The kit's review
   record is written by the assistant, so it catches forgetting, not cheating (`docs/review-gate.md`).
6. **Gates follow the profile** (`solo`, `team`, `org`), where the playbook ties them to risk. Routine work is
   exempt from the planning gate to bring the two closer.
7. **Left out:** Claude in CI, managed settings, worktrees and parallel sessions, Maintain-stage plays, and
   reading GitHub branch protection.
8. **The factory (opt-in) lets agents push feature branches and open pull requests.** By default the kit still
   has a person push. With `factory.mode: pr` the agents push feature branches and watch CI; they never merge,
   deploy or push the protected branch, and org asks for a yes before each push. This is a deliberate step past the
   default flow, not a playbook practice, so it is not in the scorecard above (`docs/factory.md`).

## Kit additions beyond the playbook

The workflow profile (`.claude/workflow.json`, `docs/workflow-profiles.md`), `write-project-overview` with `overview-check.mjs`, the stack pack for
Expo, `figma-sync`, `changelog-bump`, `pr-description`, `readable-fix-plan`, and the harsh
`ultra-code-quality-review`. Added in the factory work: the `run-factory` skill with `factory-guard.mjs` and the
`factory-builder` agent (build to pull requests or stacks, GitHub and GitLab, CI watching with a fix cap),
`e2e-tests` with `e2e-shots.mjs` (Playwright proven, Maestro written from documentation and not verified), and
single-agent flows for Cursor, Codex, OpenCode and Cline (not run).

## What this page does not claim

- That any of this improves results; it shows what exists and how it was checked.
- That a model-reported answer will repeat; each is one sample.
- Pieces not yet run: plan mode, the `setup-workspace` skill with
  the newest pieces, and a pull into a project that already has its own overview and skills. A project that
  has pulled the kit holds it as of its last pull (`.claude/workspace-kit/.kit-version`).

## Keeping it true

After a change to the kit, update the rows it touches. `node templates/scripts/overview-check.mjs --root . --file docs/playbook-mapping.md`
reports a path named here that no longer exists.
