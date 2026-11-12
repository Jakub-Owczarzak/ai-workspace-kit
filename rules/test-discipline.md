# Rule: test discipline

How strict comes from the workflow profile: `.claude/workflow.json` (a missing file means `solo`), or
`node scripts/workflow-config.mjs`. Two controls matter: `tests.tdd` (`off`, `bugs`, `on`) and `tests.guard` (`off`, `on`).

- **A bug fix starts with a failing test** (unless `tests.tdd` is `off`). Reproduce the bug as a test, run it and show it
  failing for the reason you expect. Only then change the code, and never edit that test to make it pass. Then show it
  passing and run the whole suite.
- **New logic is test-first** when `tests.tdd` is `on`, or when the plan marks the bucket `TDD: yes`: turn each
  acceptance criterion into a failing test, then write the least code that makes it pass. When `tests.tdd` is `bugs`,
  writing tests together with the code is fine.
- **Never skip, delete, weaken or loosen a failing test to get to green.** If you think the test is wrong, stop, say
  why, and ask the user.
- **Report with proof.** "Done" names the commands that ran and shows their output (counts, exit status). What cannot
  be unit tested is said plainly, with what was checked instead, or "not checked".
<!-- wk:if check.test-edit-guard -->
- **When `tests.guard` is `on`, use fix mode** so the guard hook protects the proof (details file).
<!-- wk:endif -->

When to mark a bucket `TDD: yes`, and fix mode: `.claude/workspace-kit/rules/test-discipline-details.md`.
