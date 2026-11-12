# Test discipline: the details

Read this when you start a bug fix or new logic with tests. The short rule is in the project's instruction file.
Passages marked `wk:if <option>` apply only when that kit option is installed in this project.

## The order for new logic (`tests.tdd` is `on`, or the bucket is `TDD: yes`)

Turn each acceptance criterion of the plan into a test before any implementation, show them failing, write the least
code that makes them pass, show them passing, then clean up with the tests green.

## When to mark a piece `TDD: yes`

Mark it when its acceptance criteria are fixed in the plan and a mistake is costly: security or money logic
(authentication, payments), packages other projects will reuse, parsing and pricing rules. Do not force it on layout or
exploratory work, where the shape is still being found.

<!-- wk:if check.test-edit-guard -->
## Fix mode (`tests.guard` is `on`)

Use fix mode so the guard hook can protect the proof: run
`node scripts/test-edit-guard.mjs start --reason "<what is being fixed>"` before the fix, `lock` once the failing tests
are written, and `stop` at the end. The hook blocks edits to existing test files while fix mode is on. If it blocks an
edit you believe is right, do not work around it (no shell rewrite of the test file): tell the user.

<!-- wk:endif -->
## Reporting

What cannot be unit tested (a screen, a device) is said plainly, with what was checked instead (a screenshot, a manual
run) or "not checked".
