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
| `solo` | One owner who reads every diff and approves every step | Light: warnings, no gates. Nothing blocks a commit. |
| `team` | A few developers, shared repository | The guard that protects test files is on, review runs as advice, the Intent Anchor is required before code |
| `org` | Many developers shipping in parallel, policies that must hold | Strict: the docs check blocks, review and branch protection are required, success measurements are recorded |

Pick the smallest profile that fits. A control that blocks work costs time every day; turn one on when the
risk it removes is real for your project, not because it exists. Start in `solo`, and move up by editing one
line when the project grows.

## The controls

| Control | Values | solo | team | org | What it does and why it scales this way | Status |
|---|---|---|---|---|---|---|
| `planning.gates` | off, anchor, full | off | anchor | full | The planner is used on request (off); no code before the Intent Anchor is approved (anchor); plus success measurements (full). A solo owner is the shared record; many developers need one | planned: planner reads it |
| `docs.check` | off, warn, strict | warn | warn | strict | Commit hook: source changed but the overview (`AGENTS.md`) did not. Strict blocks the commit | **wired** (`check-docs-fresh.mjs`) |
| `docs.sizeWarnChars` | number, 0 = off | 40000 | 40000 | 40000 | Warn when the always-loaded instruction files are larger than this. Cheap and informational at every scale | **wired** (`doc-size.mjs`) |
| `tests.guard` | off, on | off | on | on | Block edits to test files that exist in git while fix mode is on, so a fix cannot weaken its own proof | **wired** (`test-edit-guard.mjs`; see `test-discipline.md`) |
| `tests.tdd` | off, bugs, on | bugs | on | on | Test-first policy: `bugs` = a bug fix starts with a failing test; `on` = new logic too. A bucket marked `TDD: yes` in the plan opts in under any value except `off` | **wired as a rule** (`rules/test-discipline.md`, read by the assistant) |
| `review.mode` | off, advisory, required | off | advisory | required | Independent review by a reviewer subagent against `REVIEW.md`: optional, run it, or merge needs it | planned: review gate |
| `branchProtection.check` | off, report, required | report | report | required | Read the default branch's protection from GitHub; required fails when it is missing | planned: review gate |
| `claude.runChecks` | true, false | false | false | false | Allow checks that run `claude -p` locally (the `@` import check, the skill trigger runner). They use Claude usage, so they are opt-in and never run by hooks or CI | **wired** (`run-claude-checks.mjs`) |
| `static.checks` | true, false | true | true | true | Cheap checks that need no Claude: skill lint, `@` import resolver | **wired** (`check-config.mjs`) |

"Planned" controls exist in the resolver and have defaults, but nothing reads them until the piece that uses
them is installed. Setting them now is harmless.

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
