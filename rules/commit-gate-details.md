# Commit gate: the details

Read this before your first commit in a session. The short rule is in the project's instruction file. Passages marked
`wk:if <option>` apply only when that kit option is installed in this project; skip the others.

## 1. Lint, type and tests

Fix lint, type and test errors. Never commit with any of them failing. Run them once per finished step, not after every
edit.

<!-- wk:if skill.e2e-tests|check.e2e-shots -->
When `tests.e2e` is `browser` or `native` and the change alters what a user sees or does, also run the project's e2e
command (the `# e2e` line in `AGENTS.md`; see the `wk-e2e-tests` skill) and fix failures first. If it cannot run, say
"e2e not run" and why. Never call native e2e verified.
<!-- wk:endif -->

## 2. The review

Resolve every blocking finding. How strict comes from `review.mode`: its value in `overrides` of
`.claude/workflow.json`, else the profile default (`solo` and `team` advisory, `org` required; no file means `solo`).
`node scripts/workflow-config.mjs` prints it.

<!-- wk:if review-gate -->
- `off`: review only when asked.
- `advisory` or `required`: stage the change and run `node scripts/check-review-gate.mjs --staged`. If it reports a clean
  record (its output contains a line starting `review-gate: ok`; its exit code is 0 for a reminder too, so read the
  output), go on. Otherwise start the `reviewer` subagent on the staged diff and fix its blocking findings. Save its
  report as `.claude/reviews/report.md` and record the final result with
  `node scripts/check-review-gate.mjs record --blocking <number> --summary "<one line>" --findings-file .claude/reviews/report.md`.
  Review again after a fix, because changed content needs a new record. If blocking findings remain that you decide not
  to fix, record the real number (never 0) and tell the user. In `required` mode the pre-push hook blocks a push whose
  content has no clean record. If your tool cannot start a reviewer subagent, review the staged change yourself in a
  separate pass, record it with `--self-review` and tell the user: `required` mode does not count a self-review.
- Other reviews (the ultra code quality review, a code review skill) are extra; they do not replace the record.

The review is read-only and never commits.
<!-- wk:endif -->
<!-- wk:if !review-gate -->
Review the staged change yourself when asked, in a separate pass, and tell the user what you checked.
<!-- wk:endif -->

<!-- wk:if skill.figma-sync -->
## 3. The design sync

Run the design sync if the pending-changes list has rows (see `wk-figma-sync`).

<!-- wk:endif -->
## 4. The commit

<!-- wk:if skill.changelog-bump -->
Every commit that changes behaviour or UI carries a changelog entry (see `wk-changelog-bump`). Merges, deletion-only
commits and commits that only touch the changelog or the lock file are skipped. A non-terminal commit (an assistant, a
GUI client, CI) must supply the changelog bump type and entry through the environment variables the hook documents
(`CHANGELOG_BUMP` and `CHANGELOG_ENTRY`), or the commit fails.
<!-- wk:endif -->
Commit messages say what changed and why, in the imperative mood. One logical change per commit.

## 5. Pushing

Only a human pushes. Assistants commit when asked, and never push.

<!-- wk:if skill.run-factory -->
The one exception is the factory: when the user started the `wk-run-factory` skill and `factory.mode` is `pr`, it may
push feature branches, after `node scripts/factory-guard.mjs push-check --branch <name>` says ok, and it stops for the
user's yes first when `factory.pushConfirm` is `ask`. Outside a factory run, never push.
<!-- wk:endif -->
Never push to the protected branch, never merge a pull request or deploy (factory or not), and never bypass hooks
unless the user explicitly asks.
