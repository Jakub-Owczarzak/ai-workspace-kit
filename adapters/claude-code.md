# Adapter: Claude Code

| Kit piece | Where it goes |
|---|---|
| Skills (`skills/<name>/`) | `.claude/skills/<name>/SKILL.md` (copy the whole folder, including `scripts/` and `references/`). Claude loads a skill when you type `/<name>` or when its description matches the task. |
| Always-on rules (`rules/*.md`) | `CLAUDE.md` at the project root, under "How to work". `CLAUDE.md` is loaded at the start of every session. |
| Project overview (`templates/AGENTS.md`) | `AGENTS.md`, imported from `CLAUDE.md` with `@AGENTS.md`. |
| Reviewer subagent (`templates/agents/reviewer.md`) | `.claude/agents/reviewer.md`. Claude Code lists project subagents from that folder; its checklist is `REVIEW.md` at the project root. |
| Rules for certain files only | `.claude/rules/<name>.md`. Check the current Claude Code documentation for how a rules file is scoped to paths. |
| Commit hook | The project's git hook system (husky, lefthook, plain hooks). Claude Code's own hooks (`.claude/settings.json`) can run a lint after each edit; that is separate from the commit hook. |
| Permissions | `.claude/settings.json` (shared) and `.claude/settings.local.json` (personal, do not copy between projects). |

Notes:

- `disable-model-invocation: true` in a skill's header means it only runs when you call it by name
  (`setup-workspace`, `ultra-code-quality-review`).
- The changelog hook calls the script by path (`.claude/skills/changelog-bump/scripts/changelog.mjs`).
  Keep that path in the hook and in the release workflow.
- Skills in `.claude/skills/` are listed in every session by name and description, so install only the
  pieces the project uses.
