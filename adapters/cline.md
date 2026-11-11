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

## The factory (`wk-run-factory`) in Cline

Written from Cline's documentation, read on 2026-11-11. **Not run in Cline by this kit.**

| Piece | What the documentation says, and what the kit does |
|---|---|
| Skill location | `.cline/skills`, where the kit installs `wk-run-factory`, its `references/` and the scripts it calls. |
| Starting it | By hand: type `/` and pick the skill. **The documentation describes no way to make a skill hand-start only**: skills are enabled by default and matched by their description (there is a toggle in the Skills menu). Turn the skill off there when you are not using it. The skill's first lines tell the agent not to run unless the user asked, which is the only safeguard the kit can add. |
| Subagents | Cline has a `spawn_agent` tool with a separate context window, but only in the CLI and Desktop apps, not in the VS Code or JetBrains extensions, and the documentation describes no way to define your own subagents. So the factory runs in single-agent mode ("Without subagents" in the skill). |
| Hosts | GitHub and GitLab, as in Claude Code. |
