# Rule: the commit gate

Before every commit, in this order:

- Fix lint, type and test errors. Never commit with any of them failing; run them once per finished step.
<!-- wk:if review-gate -->
- Review the change and resolve every blocking finding. `review.mode` says how strict (`node scripts/workflow-config.mjs`
  prints it): in `advisory` or `required` mode run `node scripts/check-review-gate.mjs --staged`, and record the review.
<!-- wk:endif -->
<!-- wk:if !review-gate -->
- Review the change when asked, and resolve every blocking finding.
<!-- wk:endif -->
<!-- wk:if skill.changelog-bump -->
- Add a changelog entry for a change in behaviour or UI (see `changelog-bump`).
<!-- wk:endif -->
- Then commit.

Before your first commit in a session, read `.claude/workspace-kit/rules/commit-gate-details.md` for the full procedure.

Standing guards:

<!-- wk:if !skill.run-factory -->
- Only a human pushes. Assistants commit when asked and never push.
<!-- wk:endif -->
<!-- wk:if skill.run-factory -->
- Only a human pushes. Assistants commit when asked and never push, except a factory run the user started (see the
  details file).
<!-- wk:endif -->
- Never push to the protected branch (main or master). Push a feature branch and open a pull request.
- Never merge a pull request or deploy. A person merges.
- Never bypass hooks (`--no-verify`, skipping signing) unless the user explicitly asks, and say what was skipped. A
  failing hook is a signal: fix the cause, do not retry around it.
- Commit messages say what changed and why, in the imperative mood. One logical change per commit.
- Do not edit the version by hand; the release process owns it.
