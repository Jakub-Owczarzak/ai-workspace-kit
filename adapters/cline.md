# Adapter: Cline

Checked against Cline's documentation (rules and skills pages) on 2026-11-10.

| Kit piece | Where it goes |
|---|---|
| Skills (`skills/<name>/`) | `.cline/skills/wk-<name>/SKILL.md` (Cline's recommended folder). Cline also reads `.clinerules/skills/` and `.claude/skills/`, so when Claude Code is selected too, its `.claude/skills` copy is used and no second copy is made. **Cline does not read `.agents/skills`.** `name` must exactly match the folder name; `description` is limited to 1024 characters. |
| Always-on rules (`rules/*.md`) | One marked block in `AGENTS.md`, which Cline detects. Cline's own folder is `.clinerules/` (or `.cline/rules/`), where every markdown file without `paths:` frontmatter is always active; the kit does not need it. |
| Project overview | `AGENTS.md` at the project root. |
| Commit and push hooks | The project's git hooks. |

Notes:

- `CLAUDE.md` is not documented as read by Cline, which is why the rules live in `AGENTS.md`.
- If a global skill and a project skill share a name, the global one wins. The `wk-` prefix avoids that.
