# Rule: keep the docs fresh (every change)

After every change, check whether the documents that describe it are still true, then update them in the
same turn. Do not wait to be asked.

- **Overview document** (`AGENTS.md` or equivalent): features, state, routes or endpoints, conventions,
  known quirks. Bump its "Last updated" line.
- **Router skill and rules**: when a convention or a workflow rule changes.
- **Plan and backlog files**: mark finished items, add new open items, record decisions.
- **Changelog**: never edited by hand; the commit step adds entries.
- **Copies for other tools** (for example a second copy of the rules for another assistant): write both
  from the same text and run `diff` to confirm they are identical.

Do this for navigation, state, data, theme, error handling, file layout, build, release and repository
setup. If a change makes a statement in a document false, fixing the document is part of the change.

A commit hook can back this up: `templates/scripts/check-docs-fresh.mjs` warns when source changed but the
overview is not part of the commit (`DOCS_CHECK=strict` blocks). It cannot tell whether the overview
needed a change, so a warning is a prompt to check, not proof of a stale document.

Write the docs for the next person to read cold: what is true now, where it lives, what is not done. Mark
anything unverified as unverified.
