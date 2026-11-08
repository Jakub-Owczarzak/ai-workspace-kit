# Rule: the commit gate

The order before every commit:

1. **Fix lint, type and test errors.** Never commit with any of them failing. Run them once per finished
   step, not after every edit.
2. **Run the review** (code review skill or checklist) and resolve every blocking finding. The review is
   read-only and never commits.
3. **Run the design sync** if the pending-changes list has rows (see `figma-sync`).
4. **Commit.** Every commit that changes behaviour or UI carries a changelog entry (see `changelog-bump`).
   Merges, deletion-only commits and commits that only touch the changelog or the lock file are skipped.
5. **Only a human pushes.** Assistants commit when asked, and never push.

Standing guards:

- Never push to the protected branch (main or master). Push a feature branch and open a pull request.
- Never bypass hooks (`--no-verify`, skipping signing) unless the user explicitly asks, and say what was
  skipped.
- A failing hook is a signal: fix the cause, do not retry around it.
- Commit messages say what changed and why, in the imperative mood. One logical change per commit.
- A non-terminal commit (an assistant, a GUI client, CI) must supply the changelog bump type and entry
  through the environment variables the hook documents, or the commit fails.
- Do not edit the version by hand; the release process owns it.
