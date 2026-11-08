---
name: changelog-bump
description: Keep one CHANGELOG.md with an Unreleased section that each relevant commit adds an entry to, and bump the app version on release. Use when a commit needs a changelog entry, when setting up changelog entries and version bumps in a project, or when a merge to main should publish a new version. Project-agnostic; copy this folder to reuse it.
---

# Skill: changelog-bump

One `CHANGELOG.md` holds an `## Unreleased` section at the top. Each relevant
commit adds one line to it. A release turns `## Unreleased` into a version
heading, bumps the version, and starts a fresh empty `## Unreleased`.

Commits that change nothing for users are skipped, so the changelog only lists
real changes: merges, deletion-only commits, and commits that only touch
`CHANGELOG.md` or the lockfile.

## Requirements

- Node 18+ and git on PATH. No npm packages.
- The project's version lives in one or more JSON files (for example
  `package.json` `version`, or `app.json` `expo.version`).

## Commands

Run from the project root (paths below are the defaults).

### `should-skip`: check before recording

```bash
node .claude/skills/changelog-bump/scripts/changelog.mjs should-skip
```

Exits 0 when the staged commit should not be recorded. Exits 1 otherwise.
Skips when:

- a merge is in progress (`.git/MERGE_HEAD` exists),
- nothing is added or changed (deletions only),
- only `CHANGELOG.md` or `package-lock.json` is staged,
- `CHANGELOG_SKIP=1` is set.

### `add`: record a relevant commit

```bash
node .claude/skills/changelog-bump/scripts/changelog.mjs add --bump patch --message "Describe the change in one line"
```

- Adds `- <message> (<branch>, <date>) <!-- bump: patch -->` to the
  `## Unreleased` section of `CHANGELOG.md` and stages the file. The HTML
  comment carries the bump type, and `release` removes it from the output.
- Bump is `patch`, `minor` or `major`.
- Without flags it asks on a terminal (bump defaults to patch).
- Without a terminal (Claude Code, GUI clients, CI) it reads `CHANGELOG_BUMP`
  and `CHANGELOG_ENTRY` and exits 1 if either is missing.

```bash
CHANGELOG_BUMP=minor CHANGELOG_ENTRY="Add PDF export" git commit -m "..."
```

### `release`: when a PR merges to the release branch

```bash
node .claude/skills/changelog-bump/scripts/changelog.mjs release \
  --version-file package.json:version --version-file app.json:expo.version
```

- Takes the highest bump among the Unreleased entries. With no entries it
  still bumps patch, so dependency-only and config-only merges also get a
  version.
- Bumps every `--version-file` to the same new version (the first file sets
  the current version).
- Turns `## Unreleased` into `## <version> - <date>`, keeps its bullets with the
  bump tags removed, and adds a new empty `## Unreleased` above it.
- Prints the new version on the last line. `--dry-run` shows the new version
  and changes nothing.

## Rules

- **Relevant commits add one entry**, including commits Claude makes. Write the
  description before committing; the `add` step does it in the same commit.
- Do not edit the version files by hand; `release` owns them.
- Do not edit `## Unreleased` by hand. Add entries with `add`.
- Keep descriptions to one line in the imperative mood ("Add ...", "Fix ...").

## Wiring into a project

1. Copy `.claude/skills/changelog-bump/` into the project.
2. In the pre-commit hook, after lint and tests: call `should-skip`; if it
   exits 1, prompt for or read the bump and entry, then call `add`. Run from
   the directory that holds `CHANGELOG.md`.
3. Add a CI job on the main branch that runs `release` and commits the result
   or opens a release PR (the main branch is often protected, so a PR is safer).
4. Pass `--changelog` and `--version-file` when the project layout differs from
   the defaults.

## Tests

```bash
node --test .claude/skills/changelog-bump/scripts/changelog.test.mjs
```

## Limits

- Several branches adding entries to the same `## Unreleased` section will
  conflict on merge. The conflict is a simple one: keep both lines.
- The version must be `x.y.z`; prerelease tags are not handled.
- JSON version files are re-written with 2-space indent and a trailing newline,
  keeping the file's own line endings.
- Each entry is one line; multi-line entries are rejected.
