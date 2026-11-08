---
name: update-workspace-kit
description: Port a reusable workflow piece (skill, rule, hook script, template, stack pack) from this project back into the workspace kit, generalized, and keep the kit copies in sync. Use when a change here adds or improves something other projects would also want, when a kit-origin skill was improved in this project, when the user says "update the kit", or to check which kit-origin pieces have drifted. Asks before writing anything; never copies project facts.
---

# Update the workspace kit from this project

The workspace kit is the reusable core of the workflow (rules, skills, templates, hook scripts, stack
packs). Projects improve it in daily use. This skill moves a good improvement **back into the kit**, so the
next project starts with it, and keeps the kit's copies consistent. It is the reverse of `setup-workspace`.

## Settings (fill once per project)

| Setting | Value |
|---|---|
| Kit source folder (`<KIT>`) | `<path to the kit folder, for example C:\Users\<name>\Documents\workspace-kit>` |
| Copies to keep in sync after a kit change | `<paths of other copies of the kit, for example a starter's .claude/workspace-kit/; or "none">` |
| Kit-origin pieces installed in this project | `<skill names that came from the kit, so drift can be checked>` |
| Project-only pieces (never port) | `<skills and rules that hold this project's facts or one framework's specifics>` |

If a path is missing or does not exist, ask the user for it. Never guess and never write from memory.

## When to use

- You just created or improved a skill, rule, hook script, template or routing row, and it would help a
  different project too.
- A kit-origin skill was changed here (a fix, a clearer step, a new check).
- The user asks to update the kit, or to see what drifted.

Offer it **once, at the end of the task**, in one line ("This hook check looks reusable: port it to the
kit?"). Do not interrupt the work, and do not offer for project-specific changes.

## Step 1: is it reusable? (decide, then say why)

Port it only if all of these are true:

1. A different project, in a different domain, would plausibly use it.
2. It can be written **without this project's facts**: names, paths, branch names, ids, product words,
   framework internals. If it needs one framework's specifics, it belongs in a **stack pack**
   (`<KIT>/stacks/<stack>/`), not in the generic kit.
3. The method and the data are separable: the piece holds the procedure; the project keeps its own data in
   a file the piece reads (for example `figma-sync` and `FIGMA-SYNC.md`).
4. It has been **used here at least once** and worked, or it has a test. Say plainly if it was never run.

If it fails a test, tell the user why and leave it in the project.

## Step 2: where does it go?

| Piece | Goes to |
|---|---|
| A procedure for one kind of task | `<KIT>/skills/<name>/` (with `SKILL.md`, references, scripts and their tests) |
| A short always-on rule | `<KIT>/rules/<name>.md` |
| A commit-hook or CI script, workflow YAML | `<KIT>/templates/hooks/` or `<KIT>/templates/workflows/` (with its test beside it) |
| A starting file for a project (overview, plan, backlog, design-sync file) | `<KIT>/templates/` |
| Where a piece goes for one assistant tool | `<KIT>/adapters/<tool>.md` |
| Routing rows or a rule for one framework | `<KIT>/stacks/<stack>/` |

## Step 3: generalize (never copy as is)

Work on a copy of the text and remove or replace:

- Product, app and company names, repository and branch names, ticket prefixes, tracker links, file ids.
- Paths of this project (`my-app/`, `src/...`); use placeholders such as `<PROJECT DIR>` or "the project's
  manifest" or read them from a settings table.
- Framework or language assumptions in a generic piece (move them to a stack pack, or make them a setting).
- Examples that only make sense here; replace them with neutral ones.

Keep: the method, the steps, the checks, the honesty rules, the tests. Keep the wording as short as before.

## Step 4: compare with what the kit already has, then ask

1. If the piece exists in the kit, diff the two. The kit's version may hold improvements this project does
   not have; merge them, do not overwrite them.
2. Show the user the plan: which kit files will be added or changed, a short diff, and what you removed
   while generalizing. **Ask before writing.**

## Step 5: write to the kit

- Write the files. Add or update the piece's test and run it (for a Node script: `node --test <file>`).
- Update `<KIT>/README.md` (the tables of what is inside) and, if the piece is installable,
  `<KIT>/skills/setup-workspace/SKILL.md` (which pieces it offers and where they go).
- If the piece changes how the kit is installed or imported, update the template files that carry it
  (`templates/CLAUDE.md`, `templates/hooks/pre-commit`, adapters).
- Never leave a `<...>` placeholder that you could have filled; leave only the ones a project must fill.

## Step 6: keep the other copies in sync

For every path under "Copies to keep in sync" in Settings: copy the changed files from the kit, then run
`diff -r` between the kit and the copy. They must match, except for files the copy is meant to differ in.
Do not copy over a project's own installed skills (they may carry project facts on purpose).

## Step 7: report

Say in short: what was ported and where; what was generalized away; which tests ran and their result; which
copies were synced; and what is **not verified**. Honest default: a kit piece that was written here has only
been proven in this one project. It has not been installed in a second project yet.

## Drift check (when asked, or before a larger kit change)

For each kit-origin piece listed in Settings, diff the project's installed copy against the kit's version
and report one line each: identical, project is newer, kit is newer, or both changed. Differences are often
fine (the project's copy carries project facts). List them and ask which direction, if any, to port. Do
not change anything during the check.

## Limits

- It never pushes anything, and never edits a kit file without showing the change first.
- The kit is a plain folder. If it is not under version control, say so once and suggest `git init` there,
  because a bad port is otherwise hard to undo.
- It does not decide for the user what is worth sharing. When unsure, explain the trade-off in two lines and
  ask.
