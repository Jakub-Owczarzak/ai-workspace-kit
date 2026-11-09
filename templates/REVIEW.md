# Review checklist: <PROJECT NAME>

What the `reviewer` subagent checks before a commit, in this order. The reviewer reads this file, `PLAN.md`
(when there is one), `AGENTS.md` and the change. It reports findings; it never edits, fixes or commits.

**1. Does the change do what was agreed?**
- Compare the change with the Intent Anchor, the success criteria and the current bucket's "Done when" in
  `PLAN.md`. If there is no plan, compare it with the request or the commit message, and say there was no plan.
- Flag anything outside the non-goals, anything the plan asked for that is missing, and anything the change
  adds that nobody asked for.

**2. Is it correct?**
- Read the changed code for wrong logic, unhandled failure, off-by-one and edge cases (empty, missing, large).
- Check names, numbers and paths against the code, not against the description.

**3. Is the proof shown?**
- Tests exist for new logic, and a bug fix has a test that failed first (test-discipline rule).
- Run the project's commands from `AGENTS.md` (lint, type check, tests) and report their real output. A check
  that could not run is reported as "not run", never as passing.

**4. Do the kit rules hold?** Readable code (full-word names, small units, one source of truth), repo tidiness
(each new file has its home; the map in `AGENTS.md` is updated), docs fresh (`AGENTS.md` matches the change),
verification (nothing is called "tested" that was only read).

**5. Project-specific checks** (edit this list)
- <for example: no literal user-facing text in components; colors only from the theme>
- <for example: every database change has a migration>

**Blocking or not**
- **Blocking:** wrong behaviour, a failing check, a missing test for new logic, a violated non-goal, data loss,
  a security problem, or a wrong statement in the docs.
- **Not blocking:** naming and structure improvements, optional cleanups, style the linter does not enforce.
  Report them, ranked after the blocking ones.

**How many to report**
- List every blocking finding. Report at most five non-blocking points ("nits"), most useful first, and give
  the rest as a count ("and 7 more style points"). Do not pad: a review with no findings says so.

**Ignore**
- Formatting that the commit hook already fixes. Generated and vendored files. Code the change did not touch.

**Report format** (the `reviewer` subagent follows its own file; this is the content it fills)
Plan used (yes/no, which bucket) · Checks run with their output · Findings, blocking first, each with
`file:line`, what is wrong, why, and a suggested fix described in words · What was not checked · and a last line
`Blocking: <number>`.
