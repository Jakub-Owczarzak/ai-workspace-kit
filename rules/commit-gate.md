# Rule: the commit gate

The order before every commit:

1. **Fix lint, type and test errors.** Never commit with any of them failing. Run them once per finished
   step, not after every edit.
   - When `tests.e2e` is `browser` or `native` and the change alters what a user sees or does, also run the
     project's e2e command (the `# e2e` line in `AGENTS.md`; see the `e2e-tests` skill if it is installed) and fix
     failures first. If it cannot run, say "e2e not run" and why. Never call native e2e verified.
2. **Run the review** and resolve every blocking finding. How strict comes from `review.mode`: its value in
   `overrides` of `.claude/workflow.json`, else the profile default (`solo` and `team` advisory, `org`
   required; no file means `solo`). `node scripts/workflow-config.mjs` prints it.
   - `off`: review only when asked.
   - `advisory` or `required`: stage the change and run `node scripts/check-review-gate.mjs --staged`. If it
     reports a clean record (its output contains a line starting `review-gate: ok`; its exit code is 0 for a
     reminder too, so read the output), go on. Otherwise start the `reviewer` subagent on the staged diff and fix its
     blocking findings. Save its report as `.claude/reviews/report.md` and record the final result with
     `node scripts/check-review-gate.mjs record --blocking <number> --summary "<one line>" --findings-file .claude/reviews/report.md`.
     Review again after a fix, because changed content needs a new record. If blocking findings remain that
     you decide not to fix, record the real number (never 0) and tell the user. In `required` mode the
     pre-push hook blocks a push whose content has no clean record. If your tool cannot start a reviewer subagent,
     review the staged change yourself in a separate pass, record it with `--self-review` and tell the user:
     `required` mode does not count a self-review.
   - Other reviews (the ultra code quality review, a code review skill) are extra; they do not replace the record.
   The review is read-only and never commits.
3. **Run the design sync** if the pending-changes list has rows (see `figma-sync`).
4. **Commit.** Every commit that changes behaviour or UI carries a changelog entry (see `changelog-bump`).
   Merges, deletion-only commits and commits that only touch the changelog or the lock file are skipped.
5. **Only a human pushes.** Assistants commit when asked, and never push. The one exception is the factory: when
   the user started the `factory` skill (if it is installed) and `factory.mode` is `pr`, it may push feature
   branches, after `node scripts/factory-guard.mjs push-check --branch <name>` says ok, and it stops for the
   user's yes first when `factory.pushConfirm` is `ask`. Outside a factory run, never push.

Standing guards:

- Never push to the protected branch (main or master). Push a feature branch and open a pull request.
- Never merge a pull request or deploy, factory or not. A person merges.
- Never bypass hooks (`--no-verify`, skipping signing) unless the user explicitly asks, and say what was
  skipped.
- A failing hook is a signal: fix the cause, do not retry around it.
- Commit messages say what changed and why, in the imperative mood. One logical change per commit.
- A non-terminal commit (an assistant, a GUI client, CI) must supply the changelog bump type and entry
  through the environment variables the hook documents, or the commit fails.
- Do not edit the version by hand; the release process owns it.
