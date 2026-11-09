# Rule: keep the docs fresh (every change)

After every change, check whether the documents that describe it are still true, then update them in the
same turn. Do not wait to be asked.

- **Overview document** (`AGENTS.md` or equivalent): features, state, routes or endpoints, conventions,
  known quirks. Bump its "Last updated" line.
- **Router skill and rules**: when a convention or a workflow rule changes.
- **Plan and backlog files**: mark finished items, add new open items, record decisions. The plan moves with
  the code: when the work departs from `PLAN.md`, update it in the same commit, not later.
- **Changelog**: never edited by hand; the commit step adds entries.
- **Copies for other tools** (for example a second copy of the rules for another assistant): write both
  from the same text and run `diff` to confirm they are identical.

**One source of truth per artifact.** Each artifact (the plan, the spec, the overview, tickets, config, a
design) has one home, named in the overview's "Sources of truth" list (add the list if the overview has none). Anything else that mentions it holds a
link, not a copy. If the home is an outside system (a ticket tracker), write its link in the repository and
update that system in the same session.

Do this for navigation, state, data, theme, error handling, file layout, build, release and repository
setup. If a change makes a statement in a document false, fixing the document is part of the change.

A commit hook can back this up: `templates/scripts/check-docs-fresh.mjs` warns when source changed but the
overview is not part of the commit (`DOCS_CHECK=strict` blocks). It cannot tell whether the overview
needed a change, so a warning is a prompt to check, not proof of a stale document.

Write the docs for the next person to read cold: what is true now, where it lives, what is not done. Mark
anything unverified as unverified.
