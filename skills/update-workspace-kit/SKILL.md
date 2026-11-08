---
name: update-workspace-kit
description: Keep a project and the workspace kit (a git repository) in step. PUSH mode ports a reusable workflow piece (skill, rule, hook script, template, stack pack) from this project into the kit, generalized, on a branch. PULL mode updates this project's copy of the kit, and the installed skills that are behind, from the kit's latest version. Use when a change here adds or improves something other projects would want, when the user says "update the kit" or "pull the latest kit", or to check drift. Asks before writing or pushing anything; never copies project facts.
---

# Keep this project and the workspace kit in step

The workspace kit is the reusable core of the workflow (rules, skills, templates, hook scripts, stack
packs). It lives in **a git repository**, not on one machine. Projects improve it in daily use, and
projects started later should get those improvements. This skill moves changes both ways:

- **Push** (project → kit): port a reusable improvement into the kit repository.
- **Pull** (kit → project): update this project's copy of the kit and its installed skills from the
  kit's latest version.

## Settings (fill once per project)

| Setting | Value |
|---|---|
| Kit repository | `<URL of the kit repository>`, branch `<main>` |
| Local clone of the kit (optional) | `<path of an existing clone, or "none">`. Used only if it exists, has no uncommitted changes and is on the default branch after `git fetch`; otherwise a fresh clone is made |
| This project's copy of the kit | `<path inside the project, for example .claude/workspace-kit/>` |
| Kit-origin pieces installed in this project | `<skill names that came from the kit, so drift can be checked>` |
| Project-only pieces (never port) | `<skills and rules that hold this project's facts or one framework's specifics>` |

If a value is missing, ask the user. Never guess and never write from memory.

## Step 0: get the kit (both modes)

1. If the optional local clone qualifies (see Settings), run `git fetch` and fast-forward it; use it as the
   **working copy** `<KIT>`.
2. Otherwise clone into a **temporary folder outside the project** (the session scratchpad or the system
   temp folder): `git clone <repository> <folder>`. A shallow clone (`--depth 1`) is enough to pull;
   push mode needs a normal clone.
3. If the clone fails on access (a private repository), say so and ask the user to sign in (`gh auth login`
   or their usual git credentials). Never ask for, store or print a token.
4. Say which kit commit you are using (`git rev-parse --short HEAD`) and where the working copy is.

Never leave the working copy inside the project, and never delete a clone that holds a commit that has not
been pushed until the user has pushed it or said to discard it.

## PUSH mode: port an improvement into the kit

### When to use

- You just created or improved a skill, rule, hook script, template or routing row that a different project
  would also want.
- A kit-origin skill was changed here (a fix, a clearer step, a new check).
- The user asks to update the kit.

Offer it **once, at the end of the task**, in one line ("This hook check looks reusable: port it to the
kit?"). Do not interrupt the work and do not offer for project-specific changes.

### Step 1: is it reusable? (decide, then say why)

Port it only if all of these are true:

1. A different project, in a different domain, would plausibly use it.
2. It can be written **without this project's facts**: names, paths, branch names, ids, product words,
   framework internals. If it needs one framework's specifics, it belongs in a **stack pack**
   (`<KIT>/stacks/<stack>/`), not in the generic kit.
3. The method and the data are separable: the piece holds the procedure; the project keeps its own data in
   a file the piece reads (for example `figma-sync` and `FIGMA-SYNC.md`).
4. It has been **used here at least once** and worked, or it has a test. Say plainly if it was never run.

If it fails a test, tell the user why and leave it in the project.

### Step 2: where does it go?

| Piece | Goes to |
|---|---|
| A procedure for one kind of task | `<KIT>/skills/<name>/` (with `SKILL.md`, references, scripts and their tests) |
| A short always-on rule | `<KIT>/rules/<name>.md` |
| A commit-hook or CI script, workflow YAML | `<KIT>/templates/hooks/` or `<KIT>/templates/workflows/` (with its test beside it) |
| A starting file for a project (overview, plan, backlog, design-sync file) | `<KIT>/templates/` |
| Where a piece goes for one assistant tool | `<KIT>/adapters/<tool>.md` |
| Routing rows or a rule for one framework | `<KIT>/stacks/<stack>/` |

### Step 3: generalize (never copy as is)

Work on a copy of the text and remove or replace:

- Product, app and company names, repository and branch names, ticket prefixes, tracker links, file ids.
- Paths of this project (`my-app/`, `src/...`); use placeholders such as `<PROJECT DIR>` or "the project's
  manifest", or read them from a settings table.
- Framework or language assumptions in a generic piece (move them to a stack pack, or make them a setting).
- Examples that only make sense here; replace them with neutral ones.

Keep: the method, the steps, the checks, the honesty rules, the tests. Keep the wording as short as before.

### Step 4: compare with what the kit already has, then ask

1. If the piece exists in the kit, diff the two. The kit's version may hold improvements this project does
   not have (another project may have pushed them); merge them, do not overwrite them.
2. Show the user the plan: which kit files will be added or changed, a short diff, and what you removed
   while generalizing. **Ask before writing.**

### Step 5: write to the kit, on a branch

- In the working copy, create a branch named `port/<short-description>` from the default branch.
- Write the files. Add or update the piece's test and run it (for a Node script: `node --test <file>`).
- Update `<KIT>/README.md` (the tables of what is inside) and, if the piece is installable,
  `<KIT>/skills/setup-workspace/SKILL.md` (which pieces it offers and where they go).
- If the piece changes how the kit is installed or imported, update the template files that carry it
  (`templates/CLAUDE.md`, `templates/hooks/pre-commit`, adapters).
- Never leave a `<...>` placeholder that you could have filled; leave only the ones a project must fill.
- Commit on the branch with a message that says what the piece does and why it is reusable.
- **Do not push.** Ask: push the branch (and open a pull request with `gh pr create`), push straight to the
  default branch, or leave it local? Default suggestion: branch plus pull request, so the change can be
  reviewed. Only do what the user chooses.

### Step 6: bring this project's copy up to date

After the user has chosen, run the PULL steps below (3 and 4) so this project's own copy of the kit matches
the working copy, and record the kit commit. If the change was not pushed, say that this project is now
ahead of the repository.

## PULL mode: update this project from the kit

Use when the user says "pull the latest kit", "update from the kit", or when a drift check shows the project
is behind.

1. **See what changed.** Read the kit commit recorded in `<this project's copy>/.kit-version` (a line like
   `<commit> <date>`). If it exists, list the kit files that changed since then
   (`git diff --stat <recorded>..HEAD`); if not, compare the files and say the baseline is unknown.
2. **Show the plan** in short: new and changed kit files, grouped as rules, skills, templates, stacks. Ask
   before writing.
3. **Update this project's copy of the kit** (Settings): copy the working copy's files over it, without
   the `.git` folder. This copy is a snapshot, so it may be overwritten after the plan was approved.
4. **Record the baseline**: write `<this project's copy>/.kit-version` with the kit commit and today's date.
5. **Installed skills that are behind.** For each kit-origin skill in Settings, compare the installed copy
   with the kit's version:
   - identical to the kit's old version and different from the new one: offer to update it;
   - different because it carries project facts: show the diff, explain what the kit changed, and merge
     only the kit's improvement; never overwrite the project's facts;
   - project is newer: list it as a candidate to push.
   Apply each only after the user approves. Rules imported from the project's copy (for example from
   `CLAUDE.md`) are already current after step 3.
6. **Report**: what changed, what was skipped and why, and what is not verified.

## Drift check (when asked, or before a larger change)

Compare the project's recorded kit commit with the repository's latest commit, and each kit-origin skill
with the kit's version. Report one line each: identical, project is newer, kit is newer, or both changed.
Differences are often fine (the project's copy carries project facts). Change nothing during the check.

## Report (end of either mode)

Say in short: what was ported or updated and where; what was generalized away; which tests ran and their
result; which commit the project is now based on; and what is **not verified**. Honest default: a kit piece
written in one project has only been proven there, not in a second project.

## Limits

- It never pushes without an explicit yes, never opens a pull request unasked, and never edits a kit file
  without showing the change first.
- It does not decide for the user what is worth sharing. When unsure, explain the trade-off in two lines and
  ask.
- Two projects can change the same kit file at different times. Step 4 of push mode diffs against the
  repository's latest version for that reason; if the merge is not obvious, show both versions and ask.
