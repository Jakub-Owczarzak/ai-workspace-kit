---
name: setup-workspace
description: Install the workspace kit (clean-code rules, repo-tidiness and docs-fresh rules, commit gate, changelog and version bump, planner, PR description, fix plan, code review, design sync, router) into the current project, for whichever AI coding tools it uses. Use once per project, or again to update. Asks before changing any existing file.
disable-model-invocation: true
---

# Set up the workspace kit in a project

Run in the **project root** (the folder that holds the manifest or `.git`).

## Step 0: find the kit (before anything else)

This skill only installs; the pieces it installs (`skills/`, `rules/`, `templates/`, `adapters/`) live in
the **kit folder** (`<KIT>`). If this skill was copied into a project on its own, the kit is NOT next to it.

1. Look for a folder that contains `skills/`, `rules/`, `templates/` and `adapters/`: first the path the
   user gave in the request, then `.claude/workspace-kit/` (the recommended place), then beside this
   skill (two levels up), then the project root (`workspace-kit/`, `.workspace-kit/`).
   If this file itself was opened from inside the kit (for example
   `.claude/workspace-kit/skills/setup-workspace/SKILL.md`), that kit is the one to use.
2. If you cannot find one, **ask the user for the path** (for example
   `C:\Users\<name>\Documents\workspace-kit`). Do not guess and do not write files from memory.
3. If the kit is outside the project, you may need the user's permission to read it. Say what you will
   read, then read from it; never modify the kit itself.
4. Say which kit folder you are using before you start.

Rules for this skill: **never overwrite an existing file without asking; append or merge and show the
change. Everything is idempotent (running twice changes nothing). No network installs. No placeholder is
left silently in a written file.**

## Step 1: look at the project (read-only)

Detect and note, without asking:

- Languages and build tools (package.json, pyproject.toml, go.mod, Cargo.toml, pom.xml, composer.json...).
- The default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main` or `master`).
- Existing assistant files: `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.clinerules`, `.cursor/rules`,
  `.agents/`, `.github/copilot-instructions.md`.
- Existing git hooks (husky, pre-commit, `.git/hooks`) and CI workflows.
- Existing `CHANGELOG.md`, `README.md`, plan or backlog files.
- The commands that lint, type-check, test and build (from scripts or config).
- A framework with a stack pack in `<KIT>/stacks/` (for example an `expo` dependency in `package.json`
  means `stacks/expo-react-native/`), and whether the Expo plugin is enabled (`~/.claude/settings.json`,
  `enabledPlugins`) or `.agents/skills/` already holds the framework skills.

## Step 2: ask, in ONE round (at most four questions)

1. Which AI tools does the team use? (Claude Code, Cline, Cursor, Codex or other `AGENTS.md` readers.)
2. Which pieces to install? Default all except the ones that do not apply:
   rules (readable code, repo tidiness, docs fresh, commit gate, verification, test discipline; for the
   test-edit guard also copy `templates/scripts/test-edit-guard.mjs`, add `.claude/state/` to `.gitignore`
   and the PreToolUse hook from `docs/test-discipline.md` to `.claude/settings.json`),
   router, changelog and version bump (with hook and release workflow),
   planner, PR description, fix plan, code review, design sync (only if the project has a UI and Figma),
   and `update-workspace-kit` (to push later improvements to the kit and pull updates from it; its
   Settings table needs the kit repository URL, so ask for it when it is chosen, and record the kit commit
   you installed from in `<project copy of the kit>/.kit-version`).
3. For the changelog: which files hold the version (for example `package.json:version`), and do you want
   the commit hook and the release workflow, or only the skill?
4. Any commands or branch names I detected wrongly?

If a stack pack matches, add one question to the round: install it? Where do the framework skills come
from (the plugin, or a repo-local copy)? Default: the plugin when it is enabled, else ask.

If an answer is "you decide", pick the sensible default and record it as an assumption in the summary.

## Step 3: install

Use `adapters/<tool>.md` for the exact locations per tool. In short:

1. **Skills**: copy each chosen `skills/<name>/` folder to the tool's skills location (Claude Code:
   `.claude/skills/<name>/`; tools that read `.agents/skills/`: that folder). Skip `setup-workspace`
   itself unless the user wants it kept.
2. **Rules**: for each chosen `rules/*.md`, add its content to the project's always-on instruction file
   for each tool (see the adapter). Merge into an existing file under a clear heading; do not replace it.
   Where a tool needs one file per rule (Cursor), create one file per rule.
3. **Templates**: create from `templates/` only the files that do not exist: `AGENTS.md`, `BACKLOG.md`,
   `PLAN.md`, `FIGMA-SYNC.md`, `CHANGELOG.md`. Fill the placeholders with what you detected and asked.
   Ask about each placeholder you cannot fill.
4. **Router**: copy `skills/workspace-router/` and fill its tables: the project's own skills and
   documents, and remove rows for pieces that were not installed.
5. **Hooks and CI** (only if chosen): wire `templates/hooks/pre-commit` into the project's existing hook
   system by appending the changelog block and the project's lint, type and test commands (do not replace
   an existing hook). Adapt `templates/workflows/release_bump.yaml` (branch, paths, version files) and
   show it before writing.
5b. **Workflow profile** (always): ask which profile fits (`solo`, `team`, `org`; default `solo`, see
   `<KIT>/docs/workflow-profiles.md`), copy `templates/workflow.json` to `.claude/workflow.json` with that
   profile, and copy `templates/scripts/workflow-config.mjs` next to the project's other scripts. Install
   `check-docs-fresh.mjs` only together with `workflow-config.mjs`. Offer the config checks
   (`check-config.mjs`, `check-skills.mjs`, `check-imports.mjs`, `doc-size.mjs`, `run-claude-checks.mjs`,
   from `templates/scripts/`; copy the scripts, not their tests, into the project's `scripts/` folder) and
   a `check:config` shortcut in the manifest; see `<KIT>/docs/config-checks.md`. Each installed skill keeps
   its `triggers.json` beside its `SKILL.md`. When `AGENTS.md` does not exist yet, run the
   `write-project-overview` skill (create mode) instead of filling the template by hand, and copy
   `overview-check.mjs` next to the other scripts (see `<KIT>/docs/project-overview.md`). Offer the review
   gate (see `<KIT>/docs/review-gate.md`): `templates/REVIEW.md` to the project root, `templates/agents/reviewer.md`
   to `.claude/agents/`, `check-review-gate.mjs` to `scripts/`, the review-gate lines of `templates/hooks/pre-push`
   appended to the pre-push hook, and `.claude/reviews/` added to `.gitignore`. When the profile is `team` or
   `org`, also offer plan mode as the session default: merge `{"permissions": {"defaultMode": "plan"}}` into
   `.claude/settings.json` (never overwrite it) and say it does not apply in the VS Code extension (see
   `<KIT>/docs/workflow-profiles.md`).
6. **Stack pack** (only if chosen): paste the rows of `<KIT>/stacks/<stack>/router-rows.md` into the router's
   section 2.2 (drop rows for skills the project will not have; use the `expo:` names for the plugin, the
   `.agents/skills/` paths for a repo-local copy), and add the pack's `rules/*.md` to the always-on file like
   the other rules. Put project facts (SDK version, layout, quirks) in `AGENTS.md`, never in the router.
7. **Identical copies**: if a file exists for two tools (for example `CLAUDE.md` rules and
   `.clinerules/`), write both from the same text and run `diff`.

## Step 4: verify

- The skill folders exist where the tool reads them, each with a `SKILL.md`.
- If the changelog was installed: `node <skills>/changelog-bump/scripts/changelog.mjs should-skip` runs;
  the tests pass (`node --test <skills>/changelog-bump/scripts/changelog.test.mjs`).
- No leftover `<...>` placeholders in written files (search for them).
- The identical copies match (`diff`).

## Step 5: summary

Report in short: what was installed and where, what was skipped and why, the assumptions made, the files
the user must still edit by hand (placeholders, tables), and one suggested first step (for example "make a
small change and let the commit hook ask for a changelog entry"). Do not commit; the user reviews first.

## Limits

- It does not download framework skills (for example Expo or React skills). A stack pack in
  `<KIT>/stacks/` supplies the routing rows and the rule for one framework; the skills themselves come from
  the plugin or a repo-local copy. For a framework with no pack, add rows to the router's project table.
- Hooks differ per project (husky, lefthook, pre-commit, plain git hooks). Adapt; do not force one.
- Design sync needs the Figma connector and a Figma file; skip it for projects without a UI.
