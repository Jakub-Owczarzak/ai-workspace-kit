# Install, uninstall and keep the kit up to date

Sections 8 and 9 of the former README: requirements, what the installer does, which tools read what, uninstall, and updating. Back to the [README](../README.md).

## 8. Install and use

### Requirements

- **Node 18 or newer.** The installer is plain Node with no dependencies.
- **git** is needed only for the hook step; without a git repository the hooks are reported, not written.
- Windows, macOS and Linux. The tests and the install smoke test run on all three, on Node 18 and 22, in CI
  (current state: [section 11](design-and-evidence.md#11-how-it-was-checked-and-what-is-not-proven)).

### Install (once per project)

**1. Copy the kit into the project.** From the project folder:

| Where from | Command |
|---|---|
| npm (normal) | `npx ai-workspace-kit init` |
| The newest unreleased code on GitHub | `npx github:Jakub-Owczarzak/ai-workspace-kit init` |

The npm form was tried from the real registry on 2026-11-10 in an empty folder: `init`, the installer, an uninstall
preview and a real uninstall all worked (Windows). A packed tarball also works: `npm pack`, then
`npx ./ai-workspace-kit-<version>.tgz init` (give a relative path; on Windows `npx` silently does
nothing when it is given an absolute `C:/...` path).

`init` writes **only** inside `.claude/workspace-kit/`. It is all or nothing: if that folder already holds
kit files that differ from this version (an older copy of the kit, or edits made by hand), it writes nothing,
lists them, and exits with code 2. Options: `--dir <path>`, `--dry-run`, `--force` (replace the kit's own files).

**2. Run the setup prompt.** Open your AI tool in the project and say:

> Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it.

A tool without skill support can use the paste-in text in [`docs/setup-prompt.md`](setup-prompt.md).

**3. Answer the questions.** They come from [`catalog/options.json`](../catalog/options.json), which gives every
rule, skill, hook, check and control a title, a one-line "what it does" and a one-line "how it changes your
workflow". In rounds of at most four questions:

| Round | You decide |
|---|---|
| 1 | Which AI tools (Claude Code, Cursor, Codex, OpenCode, Cline) and which profile (`solo`, `team`, `org`) |
| 2 | Whether to keep the profile's strictness defaults, or change single controls |
| 3 | What to install, one group at a time: rules, skills, hooks and CI, review gate and checks, templates and settings |
| 4 | Project facts for what you chose: the lint / type / test commands, the protected branch, the files that hold the version |

**4. Preview, then apply.** The assistant writes your answers to `.claude/workspace-kit/answers.json`, shows a
**dry run** (created, skipped, manual, notes, warnings), waits for your yes, and then installs. The installer
is a program, not the assistant copying files, so it behaves the same everywhere:

```text
node .claude/workspace-kit/bin/cli.mjs apply --choices .claude/workspace-kit/answers.json --dry-run
node .claude/workspace-kit/bin/cli.mjs apply --choices .claude/workspace-kit/answers.json
```

```json
{
  "profile": "team",
  "tools": ["claude-code", "cursor"],
  "overrides": { "docs.check": "strict" },
  "enabled": ["rule.verification", "skill.pr-description", "hook.pre-commit", "review-gate", "check.static"],
  "project": {
    "commands": { "lint": "npm run lint", "typecheck": "npm run typecheck", "test": "npm test" },
    "protectedBranch": "main",
    "versionFiles": ["package.json:version"]
  }
}
```

Running it again changes nothing. Options an option needs are added for you and reported. An answer the program
needs but does not have (for example the version files for the release workflow) means that one piece is not
written, and the report names what is missing.

### What the installer does and does not do

The project already has its own skills, hooks, workflows and instruction files. The kit is built to sit beside
them: it creates new things, adds clearly marked blocks, and otherwise leaves your files alone.

| Your file or folder | What the kit does |
|---|---|
| Your skills | Kit skills are installed as `wk-<name>` (for example `wk-pr-description`), and references between them are rewritten. A skill of yours with the plain name is never touched; if one exists, a note says both are now visible. |
| `CLAUDE.md` / `AGENTS.md` | One block between `workspace-kit:start rules` and `workspace-kit:end rules`. Your text outside it is never touched. With several tools the rules are written **once**, in `AGENTS.md`, and `CLAUDE.md` gets a marked `@AGENTS.md` import. Rules you already import with `@.claude/workspace-kit/rules/...` are not repeated. |
| Git hooks (husky, `core.hooksPath`, `.git/hooks`) | One marked block chained into your hook; your lines before and after stay as they are. Whatever the hook already runs (lint, tests, docs-fresh, changelog) is left out of the block. |
| A hook the kit cannot edit safely | `lefthook`, the Python `pre-commit` tool, a non-shell hook, or a pre-push hook that reads stdin (git-lfs): nothing is written, and the exact lines to add are printed. |
| `.claude/settings.json` | Keys are added, never replaced: `permissions.defaultMode` only if you have not set it, and one `PreToolUse` entry for the test-edit guard. A file with comments is never rewritten. |
| `.gitignore`, `package.json` | A marked block of ignore lines; a `check:config` script, only if that name is free. |
| `PLAN.md`, `CHANGELOG.md`, `REVIEW.md`, `.claude/workflow.json`, the release workflow | Created if missing. **Never replaced, not even with `--force`**, because once they exist they are your data. |
| `scripts/*.mjs` | Created if missing. An older copy is skipped with a **warning** (newer scripts depend on it), and `--force` replaces it. |

The installer makes no network calls, writes nothing outside the project folder, and never commits or pushes.

### Which tools read what

Locations were checked against each tool's official documentation on 2026-11-10; the per-tool pages are in
`adapters/`.

| Tool | Skills are installed in | Always-on rules | Worth knowing |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `CLAUDE.md` | Subagent, plan mode and `settings.json` hooks are Claude Code features |
| Codex | `.agents/skills/` | `AGENTS.md` | |
| Cursor | `.agents/skills/` | `AGENTS.md` | Does not read `CLAUDE.md`; `.cursor/rules` files must be `.mdc` (the kit does not write them) |
| OpenCode | `.agents/skills/` (it also reads `.claude/skills/`) | `AGENTS.md` | With both files present only `AGENTS.md` is read |
| Cline | `.cline/skills/` (it also reads `.claude/skills/`, **not** `.agents/skills/`) | `AGENTS.md` | Has its own `.clinerules/` folder, which the kit does not need |

A tool never gets a second copy when another selected tool's folder is one it already reads.

### Uninstall

One command removes everything the installer added, and nothing else:

```text
node .claude/workspace-kit/bin/cli.mjs uninstall           # a preview: shows exactly what would go, changes nothing
node .claude/workspace-kit/bin/cli.mjs uninstall --yes     # does it
```

(`npx ai-workspace-kit uninstall` also works once the package is on npm.) It can do this safely because `apply`
keeps a record, `.claude/workspace-kit/manifest.json`, of what it created and changed. The uninstaller removes only
what that record lists:

| What | What the uninstaller does |
|---|---|
| Files the kit created (skills, scripts, templates such as `PLAN.md`, the reviewer agent, the release workflow) | Deleted **only while they are still exactly what the kit wrote**. A file you edited since is kept and listed as `KEPT` (a Windows line-ending change is not an edit). |
| Marked blocks in your own files (rules in `CLAUDE.md` or `AGENTS.md`, hooks, `.gitignore`) | The block is cut out; your text stays. If the kit created the file and nothing else is in it, the file goes too. |
| Keys the kit added to `.claude/settings.json` | Only those keys. A value you changed since (for example `defaultMode`) is kept. |
| The `check:config` script in `package.json` | Removed only while it is still the kit's command. |
| Folders that end up empty | Removed, but never anything inside `.git`. |
| `.claude/workspace-kit/` itself | Removed last. `--keep-kit` keeps it, with a fresh record, so you can run the setup again. |

What it does **not** touch: your own skills (even one with the same plain name), your own scripts and hooks, review
records and fix-mode state in `.claude/reviews/` and `.claude/state/` (it tells you they exist), and anything the
kit never recorded. It also tells you if `CLAUDE.md` or `AGENTS.md` still imports files from the kit folder.
After it runs, look at `git status` and `git diff`. One limit: a JSON file the uninstaller rewrites
(`settings.json`, `package.json`) is written back with its own indentation, so a hand-formatted one may change in
layout, and a file with comments is never rewritten, only reported for you to edit. A project installed by a version
without a manifest cannot be uninstalled this way; the command says so and changes nothing.

### Day to day: the commands

| Command | What it does | Needs Claude? |
|---|---|---|
| `node scripts/workflow-config.mjs` | Prints the resolved profile and where each control came from | No |
| `node scripts/check-config.mjs` | Skill lint, `@` import check, doc-size report | No |
| `node scripts/overview-check.mjs` | Lists lines of `AGENTS.md` that no longer match the project | No |
| `node scripts/doc-size.mjs` | Size of the always-loaded files (measures and warns, never trims) | No |
| `node scripts/check-review-gate.mjs [--staged]` | Is there a clean review record for these contents? | No |
| `node scripts/check-review-gate.mjs record --blocking <n> ...` | Records a finished review | No |
| `node scripts/test-edit-guard.mjs start / lock / stop / status` | Fix mode for the test-edit guard | No |
| `node scripts/run-claude-checks.mjs --yes` | Asks `claude -p` about `@` imports and skill triggers | **Yes** (opt-in, uses your usage) |

**By hand, without the installer:** pick pieces from the tables, follow `adapters/<your tool>.md` for the
locations, fill the `<...>` placeholders in the templates, and wire the hooks yourself.

## 9. Keeping the kit up to date

### Installing a newer version of the kit

```text
npx ai-workspace-kit@latest init           # a newer kit than the installed one: lists what differs, writes nothing
npx ai-workspace-kit@latest init --force   # replaces the kit's own folder, .claude/workspace-kit/
git diff .claude/workspace-kit                           # review it (the folder is yours to commit)
node .claude/workspace-kit/bin/cli.mjs apply --choices .claude/workspace-kit/choices.json --dry-run
```

`.claude/workspace-kit/choices.json` is the record of your last answers, so you do not answer the questions
again. `.claude/workspace-kit/.kit-version` holds the package version of the copy you have; `apply` refuses
to run if it is missing, which is what stops a half-upgraded kit from being used.

After an upgrade the installed `wk-*` skills and the `scripts/*.mjs` are older than the kit's. They are listed
as skipped, and scripts get a **warning**: newer scripts depend on them and can silently do nothing until they
are updated. Compare, then run `apply` again with `--force`. That replaces files the kit owns, including any
edit you made to an installed `wk-` skill or script. It never replaces `PLAN.md`, `CHANGELOG.md`, `REVIEW.md`,
`workflow.json` or the release workflow.

### Moving from the old copy-the-folder install

An older install copied `rules/`, `skills/` and friends by hand and named the skills without a prefix. Running
`init` on such a project lists the kit files that differ and stops; `init --force` upgrades the folder. Then:

- the old plain-named skills stay where they are, next to the new `wk-` ones. A note lists them; delete the old
  ones if they came from the kit, keep them if they are yours;
- lines your hook already runs, and rules your `CLAUDE.md` already imports, are not added a second time;
- the old `scripts/*.mjs` get the warning above.

This was tried on a copy of a real project that had exactly that history
([section 11](design-and-evidence.md#11-how-it-was-checked-and-what-is-not-proven)).

### Sharing an improvement back: `update-workspace-kit`

This kit is also a git repository (`https://github.com/Jakub-Owczarzak/ai-workspace-kit`). The
`update-workspace-kit` skill's **push** mode (project to kit: check a piece is reusable, remove project facts,
write it to a branch of the kit, ask before pushing) is described in the skill and was not re-tested after the
npm package was introduced.

**Its pull mode predates the package and should not be used with it.** It treats `.kit-version` as a git commit
and copies a working copy over the kit folder, while the package writes its version number there and `init` is
all or nothing. To get a newer kit, use `init --force` as above. The skill has not been reworked yet.
