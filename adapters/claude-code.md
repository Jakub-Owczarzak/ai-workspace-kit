# Adapter: Claude Code

`apply` does all of this for you; this page says what it does and why.

| Kit piece | Where it goes |
|---|---|
| Skills (`skills/<name>/`) | `.claude/skills/wk-<name>/SKILL.md`, the whole folder (including `scripts/` and `references/`). The `wk-` prefix keeps them from colliding with skills the project already has; references between kit skills are rewritten to match. |
| Always-on rules (`rules/*.md`) | One marked block in `CLAUDE.md`. If another tool is selected too, the block goes into `AGENTS.md` instead and `CLAUDE.md` gets a marked `@AGENTS.md` import, so the rules exist once. |
| Project overview (`templates/AGENTS.md`) | `AGENTS.md`, imported from `CLAUDE.md` with `@AGENTS.md`. |
| Reviewer subagent (`templates/agents/reviewer.md`) | `.claude/agents/reviewer.md`; its checklist is `REVIEW.md` at the project root. |
| Plan mode as the default, test-edit guard hook | Keys merged into `.claude/settings.json`: `permissions.defaultMode` (only if unset) and one `PreToolUse` entry. Anything else in the file is kept. A file with comments is not rewritten; the setup reports it. |
| Commit and push hooks | A marked block in the project's own hook (husky, `core.hooksPath` or `.git/hooks`). Lines you wrote stay as they are. `lefthook`, `pre-commit` (the Python tool), a non-shell hook, or a pre-push hook that reads stdin (git-lfs) are reported for you to chain by hand. |

Notes:

- `disable-model-invocation: true` in a skill's header means it only runs when you call it by name
  (`setup-workspace`, `ultra-code-quality-review`).
- The changelog hook calls the script by path (`.claude/skills/wk-changelog-bump/scripts/changelog.mjs`).
- Skills in `.claude/skills/` are listed in every session by name and description, so install only the
  pieces the project uses.
- Plan mode as a project default is not read by the VS Code extension; the soft planning rule still applies.

## The factory (`wk-run-factory`)

Full support, and the only tool where it was run: two rehearsals on GitHub and one on GitLab (see
`docs/factory-rehearsal.md`).

| Piece | How it works in Claude Code |
|---|---|
| Starting it | By hand only: `disable-model-invocation: true` in the skill, started as `/wk-run-factory`. |
| Builder and reviewer | Subagents with a fresh context: `.claude/agents/factory-builder.md` and `.claude/agents/reviewer.md`, installed by `factory-core` and `review-gate`. |
| Hosts | GitHub (`gh`, optional `gh stack`) and GitLab (`glab`), through the skill's host reference files. |
| Not verified | The images in a logged-in browser; the by-hand restack under `review.mode` `required`; self-managed GitLab. |
