# Rule: test discipline

How strict this is comes from the workflow profile: read `.claude/workflow.json` (a missing file means `solo`),
or run `node scripts/workflow-config.mjs`. Two controls matter: `tests.tdd` (`off`, `bugs`, `on`) and
`tests.guard` (`off`, `on`).

**A bug fix starts with a failing test** (every profile, unless `tests.tdd` is `off`):
1. Reproduce the bug as a test. Run it and **show it failing, for the reason you expect**.
2. Only then change the code. Never edit that test to make it pass.
3. Run it again and show it passing, then run the whole suite.

**New logic is test-first when `tests.tdd` is `on`, or when the plan marks the bucket `TDD: yes`.**
Turn each acceptance criterion of the plan into a test before any implementation, show them failing, write
the least code that makes them pass, show them passing, then clean up with the tests green. When `tests.tdd`
is `bugs`, writing tests together with the code is fine.

Mark a piece `TDD: yes` when its acceptance criteria are fixed in the plan and a mistake is costly: security
or money logic (authentication, payments), packages other projects will reuse, parsing and pricing rules. Do
not force it on layout or exploratory work, where the shape is still being found.

**Never skip, delete, weaken or loosen a failing test to get to green.** If you think the test is wrong, stop,
say why, and ask the user.

**When `tests.guard` is `on`,** use fix mode so the guard hook can protect the proof: run
`node scripts/test-edit-guard.mjs start --reason "<what is being fixed>"` before the fix, `lock` once the
failing tests are written, and `stop` at the end. The hook blocks edits to existing test files while fix mode
is on. If it blocks an edit you believe is right, do not work around it (no shell rewrite of the test file):
tell the user.

**Report with proof.** "Done" names the commands that ran and shows their output (counts, exit status), as in
the verification rule. What cannot be unit tested (a screen, a device) is said plainly, with what was checked
instead (a screenshot, a manual run) or "not checked".
