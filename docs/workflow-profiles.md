# Workflow profiles

One file per project says how strict the workflow is: `.claude/workflow.json`. A **profile** sets the
defaults; **overrides** change single controls. Every hook, check script and skill that has a strictness
choice reads this file, so the kit works for one person reviewing every step and for many developers
shipping in parallel, without two versions of the kit.

```json
{ "profile": "solo", "overrides": { "docs.check": "strict" } }
```

Print the resolved settings, and where each value came from, with `node scripts/workflow-config.mjs`
(add `--json` for scripts).

## Choosing a profile

| Profile | For | In short |
|---|---|---|
| `solo` | One owner who reads every diff and approves every step | Light: warnings and advice. The Intent Anchor is agreed before non-trivial work. Nothing blocks a commit except the hooks you install. |
| `team` | A few developers, shared repository | Adds the guard that protects test files and test-first for new logic; review runs as advice |
| `org` | Many developers shipping in parallel, policies that must hold | Strict: the docs check blocks, a clean review record is required to push, success measurements are recorded |

Pick the smallest profile that fits. A control that blocks work costs time every day; turn one on when the
risk it removes is real for your project, not because it exists. Start in `solo`, and move up by editing one
line when the project grows.

## The controls

| Control | Values | solo | team | org | What it does and why it scales this way | Status |
|---|---|---|---|---|---|---|
| `planning.gates` | off, anchor, full | anchor | anchor | full | The planner is used only on request (off); no code for non-trivial work before the Intent Anchor is approved (anchor, the default for solo and team); plus success measurements (full). Even a solo owner gets the goal agreed and written down before building; many developers also need the record to be shared. A soft rule the assistant follows, with plan mode as an optional hard stop (see below) | **wired** (`CLAUDE.md` template line, `goal-first-planner`, `workspace-router`) |
| `docs.check` | off, warn, strict | warn | warn | strict | Commit hook: source changed but the overview (`AGENTS.md`) did not. Strict blocks the commit | **wired** (`check-docs-fresh.mjs`) |
| `docs.sizeWarnChars` | number, 0 = off | 40000 | 40000 | 40000 | Warn when the always-loaded instruction files are larger than this. Cheap and informational at every scale | **wired** (`doc-size.mjs`) |
| `tests.guard` | off, on | off | on | on | Block edits to test files that exist in git while fix mode is on, so a fix cannot weaken its own proof | **wired** (`test-edit-guard.mjs`; see `test-discipline.md`) |
| `tests.tdd` | off, bugs, on | bugs | on | on | Test-first policy: `bugs` = a bug fix starts with a failing test; `on` = new logic too. A bucket marked `TDD: yes` in the plan opts in under any value except `off` | **wired as a rule** (`rules/test-discipline.md`, read by the assistant) |
| `tests.e2e` | off, browser, native | off | off | off | End-to-end UI tests and screenshots: `browser` = Playwright in a headless browser, `native` = Maestro against a platform the user supplies and runs (Expo, Android Studio, Xcode or a device). Off in every profile because it needs a tool installed in the project; the kit never turns it on by itself. Works with or without the factory. The native path is prepared, not verified on a device | **wired** (`e2e-tests` skill, `scripts/e2e-shots.mjs`, the commit-gate rule, the factory preflight) |
| `review.mode` | off, advisory, required | advisory | advisory | required | Independent review by the `reviewer` subagent against `REVIEW.md` before a commit. `off` = only when asked; `advisory` = run it, and the pre-push hook reminds when there is no record; `required` = the pre-push hook blocks a push whose content has no clean review record. Even a solo owner gets a second reader that checks the change against the plan | **wired** (`check-review-gate.mjs`, `rules/commit-gate.md`; see `review-gate.md`) |
| `factory.mode` | off, local, pr | off | off | off | After the plan is approved, agents carry the work through without further prompts: `local` = build, test, review, commit and write the PR text, then stop before any push; `pr` = also push, open the PR or stack and watch CI. Off in every profile, so nothing changes until a project opts in. Nothing is ever merged or deployed; a person merges | **wired** (`run-factory` skill, `scripts/factory-guard.mjs`) |
| `factory.prLayout` | single, stack | stack | stack | stack | How a multi-bucket plan becomes pull requests: one PR, or one stacked layer per bucket (`gh stack` on GitHub, chained merge requests on GitLab, one PR per bucket where neither works). Reviewable layers suit every size of team | **wired** (`run-factory` skill; `gh stack` on GitHub, chained merge requests on GitLab, both proven) |
| `factory.ciFixAttempts` | number, 0 = report only | 3 | 3 | 2 | How many times the factory may fix a red CI run and push again before it stops and reports. org gets one fewer attempt because a failing pipeline there is more likely a policy problem than a typo | **wired** (`factory-guard.mjs attempt`, read by the `run-factory` skill) |
| `factory.host` | auto, github, gitlab | auto | auto | auto | Which code host the factory talks to; `auto` reads the git remote. The host interface is in `factory-host-interface.md` | **wired**: `github` and `gitlab` (gitlab.com proven; a self-managed server is supported by design and untested) |
| `factory.pushConfirm` | auto, ask | auto | auto | ask | Whether the factory pushes feature branches by itself or stops for a yes before each push (used when `factory.mode` is `pr`). org asks, because many developers share the repository and policies must hold. The pre-push hook refuses the protected branch either way | **wired** (`run-factory` skill, `factory-guard.mjs push-check`) |
| `factory.fastFix` | off, docs | docs | docs | off | Whether the factory may fix a tiny documentation-only problem (a CI check that wants a README line, for example) itself, with a self-check, instead of starting a builder and an independent reviewer. The limit is enforced by `factory-guard.mjs fast-check`: only Markdown, README, `docs/` and CHANGELOG files, at most 10 changed lines; anything that touches code always goes to a builder. org keeps `off` because a required review means an independent reader for every change | **wired** (`run-factory` skill, `factory-guard.mjs fast-check`) |
| `factory.untrustedText` | stop, note | note | stop | stop | What the builder does when text it reads (a file, a log, PR or issue text) gives it an order. Neither value follows it. `stop`: the builder stops with `blocked: instruction found in <where>` and the run asks you; `note`: it records the text in its handoff and carries on. solo is lighter because in a project only you write there is little outside text to be wary of; team and org stop, because other people's pull requests, dependencies and logs reach the files the factory reads and it runs unattended | **wired** (`run-factory` skill, `factory-builder` and `reviewer` agents) |
| `claude.runChecks` | true, false | false | false | false | Allow checks that run `claude -p` locally (the `@` import check, the skill trigger runner). They use Claude usage, so they are opt-in and never run by hooks or CI | **wired** (`run-claude-checks.mjs`) |
| `static.checks` | true, false | true | true | true | Cheap checks that need no Claude: skill lint, `@` import resolver | **wired** (`check-config.mjs`) |

A control marked "planned" would exist in the resolver and have defaults, but nothing would read it until the
piece that uses it is installed. Setting it is harmless. (None are planned now. `tests.e2e` and the `factory.*`
controls are read by their skills only when those skills are installed, and only act when you turn them on.)

### `planning.gates` and plan mode

`planning.gates` is a rule the assistant follows: with `anchor` or `full` it writes no production code for
non-trivial work until the Intent Anchor in `PLAN.md` is approved. Routine work (a tight request, a small
blast radius, code the tests already cover) is exempt. Nothing can detect "non-trivial", so this is advice,
not a block. The playbook's own mechanism for a hard stop is Claude Code's **plan mode**, where Claude cannot
edit files until the plan is accepted. For `team` and `org` the setup offers it as the project default:

```json
{ "permissions": { "defaultMode": "plan" } }
```

in the project's `.claude/settings.json`, merged with what is there. Limits, from the Claude Code docs as
read on 2026-11-09 (not tried here):
- Every session starts in plan mode, trivial ones included. Shift+Tab leaves it without approving a plan.
- **Sessions started from the VS Code extension do not read the project's starting mode**, so it does not
  apply there; the soft rule still does.
- The docs do not say whether this key waits for the project-trust prompt. Check it on your machine before
  relying on it.

## Precedence

For each control, highest first:

1. **An environment variable**, for one command. Each control has one (for example `DOCS_CHECK=strict git
   commit ...`), and `WORKFLOW_PROFILE=org` switches the whole profile.
2. **`overrides`** in `.claude/workflow.json`.
3. **The profile default** from the table above.

## Safety

The resolver never throws and never blocks work. A missing file means `solo`. A file that is not valid JSON,
an unknown profile, an unknown control or an invalid value is ignored with a one-line warning, and the next
lower layer is used. A hook that cannot run (for example, the resolver file is missing) falls back to the
old behaviour or allows the commit; it does not stop it.

## For skills

A skill that has a strictness choice says so in its text: "read `.claude/workflow.json`; if it is missing the
profile is `solo`". Skills do not run the resolver; read the file, or run `node scripts/workflow-config.mjs`
and read its output.

## Adding a control

1. Add it to `CONTROL_SPECS` and to all three tables in `PROFILES` in `workflow-config.mjs` (the tests fail
   if one profile lacks it).
2. Add a row to the table above, with the reason for each profile's value.
3. Make the script or skill that uses it read it, and add a test for each value.
4. Set its Status in the table to **wired**.

## Where the files are

| File | Purpose |
|---|---|
| `templates/workflow.json` | The file a project copies to `.claude/workflow.json` |
| `templates/scripts/workflow-config.mjs` | The resolver, its CLI, and the tables (copy it next to the other scripts, for example `scripts/`) |
| `templates/scripts/workflow-config.test.mjs` | Tests for the resolver |
| `templates/scripts/check-docs-fresh.mjs` | The first control that reads the profile |
