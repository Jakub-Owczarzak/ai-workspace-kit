---
name: setup-workspace
description: Set up the workspace kit in this project after `npx ai-workspace-kit init`. Asks which AI tools and which profile (solo, team, org) the project uses, explains every switchable rule, skill, hook and check in a line or two with its effect on the workflow, then installs only what was chosen. Use once per project, or again to change the choices. Never overwrites an existing file.
disable-model-invocation: true
---

# Set up the workspace kit in a project

Run in the **project root**. The kit was copied to `.claude/workspace-kit/` by
`npx ai-workspace-kit init` (call it `<KIT>`). This skill asks the questions and fills in the
project-specific parts; a small program, `<KIT>/bin/cli.mjs apply`, does the file work the same way on every
operating system, so you never copy files by hand.

**Ground rules (they exist because the project already has its own skills, hooks and files):**
- Never overwrite or reorder anything the user wrote. The program creates new files, adds marked blocks
  (`workspace-kit:start` ... `workspace-kit:end`) to instruction files, and skips anything that exists and
  differs. Report what it skipped.
- Kit skills are installed as `wk-<name>`, so they cannot collide with the project's own skills.
- Nothing is downloaded and nothing outside the project folder is touched.
- Do not depend on any skill, plugin or tool the user may not have. If a step needs one, say so and offer the
  manual alternative.
- Do not commit. The user reviews first.

## Step 0: check the kit is there

Look for `<KIT>/catalog/options.json` and `<KIT>/.kit-version`. If they are missing, stop and tell the user
to run `npx ai-workspace-kit init` in this folder first. Do not search elsewhere and do not
write kit files from memory. Say which kit version you found.

If the project already has an older copy of the kit, `init` writes nothing and lists the files that differ (this
skill itself may be the old one). Tell the user to run `init --force` (the kit folder is the kit's own; if it is
tracked in git, they review `git diff` afterwards) and then start the setup again.

## Step 1: look at the project (read-only, no questions)

Note: languages and build tools, the default branch, the lint / type-check / test / build commands, existing
assistant files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.agents/`, `.opencode/`), existing skills
(list their names), existing git hooks (husky, lefthook, `.git/hooks`) and CI workflows, `CHANGELOG.md`, and a
framework that has a stack pack in `<KIT>/stacks/` (for example an `expo` dependency). Tell the user briefly
what you found so they can correct it.

## Step 2: the questionnaire (from the catalog, in rounds of at most four questions)

Read `<KIT>/catalog/options.json`. **Use its `title`, `what` and `impact` text as written**; do not invent
explanations. Show each option as one line `title: what (effect: impact)`. Preselect each option's `default`
for the chosen profile.

1. **Round 1: tools and profile.** Which AI tools does this project use (Claude Code, Cursor, Codex,
   OpenCode, Cline)? Which profile (`solo`, `team`, `org`)? Quote each profile's `forWho` and `summary`.
   Default `solo`. If a stack pack matches, ask whether to add it. Tell the user where each tool will read
   the kit from (`<KIT>/adapters/<tool>.md`): with several tools the rules are written once, in `AGENTS.md`.
2. **Round 2: strictness.** List the 8 controls with the profile's defaults (see the catalog `values`, and
   `docs/workflow-profiles.md`). Ask: keep the defaults, or change some? Only ask about the controls the user
   wants to change; record changes as `overrides`.
3. **Round 3: what to install.** One group per message, as a short list, then ask "accept the preselection or
   change it?": rules; skills; hooks and CI; review gate and checks; templates and settings. If the user
   wants changes, ask which ids. Options marked `appliesWhen` are off unless that condition is true for this
   project. Options in `requires` are added automatically; say which.
4. **Round 4: project facts for what was chosen.** Ask only for what a chosen option needs, using what you
   detected in Step 1 as the proposed answer:
   - commit hook: the lint, type-check and test commands (`project.commands`);
   - push hook or release workflow: the protected branch (`project.protectedBranch`; leave it out if the push
     hook should only run the review gate);
   - release workflow and changelog: the files that hold the version as `file:key`, for example
     `package.json:version` (`project.versionFiles`).
   Without these answers the program writes nothing for that piece and reports exactly what it needs.

If the user says "you decide", use the defaults and list them as assumptions in the summary.

## Step 3: preview, then apply

1. Write the answers to `<KIT>/answers.json`:
   `{ "profile": "...", "tools": ["claude-code", ...], "overrides": { "docs.check": "strict" },
   "enabled": ["rule.verification", "skill.pr-description", ...],
   "project": { "commands": { "lint": "...", "typecheck": "...", "test": "..." }, "protectedBranch": "main",
   "versionFiles": ["package.json:version"] } }` (ids from the catalog; `project` only for what was asked).
2. Preview: `node <KIT>/bin/cli.mjs apply --choices <KIT>/answers.json --dry-run`. Show the user the list
   (created, skipped, manual). Wait for a yes.
3. Apply: the same command without `--dry-run`. Never add `--force` unless the user asks to replace a file
   that the report listed as skipped, after you showed the difference.

## Step 4: finish what the program reports as MANUAL

Read the `WARNING` lines first. A warning about older kit scripts means newer scripts may silently do nothing:
show the user the difference (`diff` each listed script against `<KIT>/templates/scripts/`), and only after they
agree run `apply` again with `--force`. That replaces kit-owned files only; `PLAN.md`, `CHANGELOG.md`,
`REVIEW.md`, `workflow.json` and the release workflow are never replaced. `NOTE` lines are information: for
example, plain-named skills from an earlier kit install now sit beside the `wk-` ones, and the user decides
whether to delete the old ones.

The program already did the hooks (a marked block chained into the project's own hook), the `.claude/settings.json`
keys (added, never replaced), the `.gitignore` block, the release workflow (a new file) and a `check:config`
script. Read the `MANUAL` and `SKIPPED` lines of the report and deal with each one the way its reason says.
Typical ones, with the same rules (new files only, marked blocks in existing files, show before writing):

- **Project overview:** if `AGENTS.md` does not exist and the overview was chosen, run
  `wk-write-project-overview` (create mode). Otherwise leave the user's `AGENTS.md` alone.
- **A hook the program could not edit** (lefthook, the Python `pre-commit` tool, a non-shell hook, a pre-push
  hook that reads stdin such as git-lfs): the `MANUAL` line is followed by the exact shell lines the kit would
  have added. Show them to the user to add to their own configuration. Do not rewrite their hook.
- **`.claude/settings.json` with comments:** show the two keys to add by hand.
- **Missing answers** (a protected branch, version files): ask, update `answers.json`, run `apply` again.
- **Placeholders:** fill the placeholders in the new template files (`PLAN.md`, `CHANGELOG.md`, ...) with what
  you detected, and ask about the ones you cannot fill. Leave no `<...>` behind.

## Step 5: verify (say what was run)

- The skill folders exist where each tool reads them, and each has a `SKILL.md`.
- If the config checks were installed: `node scripts/workflow-config.mjs` prints the chosen profile, and
  `node scripts/check-config.mjs` ends with no errors.
- If the changelog was installed: `node <skills folder>/wk-changelog-bump/scripts/changelog.mjs should-skip` runs.
  (Kit tests are not shipped to projects; do not look for them.)
- No leftover `<...>` placeholders in written files (search for them).
- Running the `apply` command a second time reports nothing created or updated.

## Step 6: summary

Report briefly: what was installed and where, what was skipped and why, the assumptions made, the files the
user still has to edit, and how to undo: `node <KIT>/bin/cli.mjs uninstall` shows a preview of everything the
setup added and `--yes` removes it (files the user edited since are kept). Suggest one first step. Do not commit.

## Limits

- It does not download framework skills (for example Expo). A stack pack supplies routing rows and a rule; the
  skills come from the plugin or a repo-local copy.
- Hooks differ per project. Adapt; do not force one.
- Design sync needs the Figma connector and a Figma file; skip it for projects without a UI.
