# Test discipline

A project's feedback loop is only as good as its tests, and an agent that fixes code can "fix" a failing
test instead. This kit handles that with one rule (`rules/test-discipline.md`), one profile control for the
test-first policy (`tests.tdd`) and one hook that protects the proof while work is in progress
(`tests.guard`, `templates/scripts/test-edit-guard.mjs`).

## The test-first policy: `tests.tdd`

| Value | Meaning | Default for |
|---|---|---|
| `off` | No rule | nobody |
| `bugs` | A bug fix starts with a failing test; new logic may be tested together with the code | `solo` |
| `on` | New logic is written test-first as well: acceptance criteria become tests before implementation | `team`, `org` |

A single piece of work can opt in even under `bugs`: mark its bucket **`TDD: yes`** in the plan. Choose it
when the acceptance criteria are fixed in the plan and mistakes are costly (an authentication or payment
package, a library other projects will reuse, a parsing or pricing rule). For layout and exploratory work the
shape is still unknown, so tests-with-code is the better fit.

The flow in a test-first bucket:
1. The plan lists the acceptance criteria ("Done when").
2. Each criterion becomes a test. Run them and show them **failing** (the pasted output is the evidence).
3. Write the least code that makes them pass, then show them **passing**, then run the whole suite.
4. Clean up with the tests green.

## The guard: `tests.guard`

When `tests.guard` is `on`, a hook blocks edits to existing test files while **fix mode** is on, so a fix has
to change the code. It acts only when all of these hold: the control is on, fix mode is on (a marker file that
expires after 4 hours), the file is a test file that is tracked in git or was locked, and `ALLOW_TEST_EDITS=1`
is not set. A new test file is always allowed, because writing the failing test first is the point.

```
node scripts/test-edit-guard.mjs start --reason "fix the rounding bug"   # fix mode on
# write the failing test as a NEW test file, run it, see it fail
node scripts/test-edit-guard.mjs lock                                    # protect the new test too
# fix the code; the hook blocks edits to the protected tests
node scripts/test-edit-guard.mjs stop                                    # fix mode off
node scripts/test-edit-guard.mjs status                                  # what is on and what is locked
```

Install: copy `test-edit-guard.mjs` and `workflow-config.mjs` into the project's `scripts/` folder, add
`.claude/state/` to `.gitignore`, and add the hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/test-edit-guard.mjs\"" }]
      }
    ]
  }
}
```

In the default `solo` profile the control is off, so the hook allows everything even with fix mode on (`start`
says so). To use it for one TDD bucket in a solo project, set `"overrides": { "tests.guard": "on" }` in
`.claude/workflow.json` for the duration.

### Safety and limits

- **It fails open.** Any error, broken input or missing resolver allows the edit and prints a warning. A broken
  guard must not stop work. Without the resolver, the marker alone turns the guard on.
- **A block explains itself:** it names the file and says what to do (change the code; ask the user to end fix
  mode or allow one edit; add a new test file instead). Each block is appended to `.claude/state/test-guard.log`.
- **It sees Edit, Write and MultiEdit only.** A shell command that rewrites a test file (`sed -i`, a redirect)
  is not seen, so the rule still says not to work around a block. Treat the hook as a guardrail, not a lock.
- **What counts as a test file:** `*.test.*` and `*.spec.*` (JS/TS), anything under `__tests__/`, `test/` or
  `tests/`, `test_*.py`, `*_test.py` and `*_test.go`.
- **Why a lock command instead of "commit the failing test":** many projects (this kit included) run the tests
  in the commit hook, so a failing test cannot be committed. `lock` protects the new tests without a commit.

## Reporting

A task is "done" when the commands ran and their output is shown (see `rules/verification.md`). What cannot be
unit tested (a screen, a device) is reported as checked another way, or as not checked.
