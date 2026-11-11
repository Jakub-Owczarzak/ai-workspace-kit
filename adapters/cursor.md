# Adapter: Cursor

Checked against Cursor's documentation (rules and skills pages) on 2026-11-10.

| Kit piece | Where it goes |
|---|---|
| Skills (`skills/<name>/`) | `.agents/skills/wk-<name>/SKILL.md`. Cursor loads `.agents/skills/` and `.cursor/skills/` automatically. It also loads `.claude/skills/` and `.codex/skills/` "for compatibility", but the kit does not rely on that. `name` must be lowercase letters, digits and hyphens and must match the folder name. |
| Always-on rules (`rules/*.md`) | One marked block in `AGENTS.md` at the project root. Cursor reads `AGENTS.md` in the root and in subfolders. It does **not** read `CLAUDE.md`. |
| Project overview | `AGENTS.md` (the same file). |
| Commit and push hooks | The project's git hooks, as for any tool. |

Optional: scoped rules. Rules that should apply only to some files belong in `.cursor/rules/<name>.mdc`,
with `globs:` in the header. **The extension must be `.mdc`; a plain `.md` file in `.cursor/rules` is ignored.**
The kit does not write these, because the always-on rules in `AGENTS.md` already reach Cursor.

```
---
description: Readable, self-documenting code
globs: src/**/*.ts
alwaysApply: false
---
<content of the rule>
```

With `alwaysApply: true` a rule is always included and `globs` and `description` are ignored.

## The factory (`wk-run-factory`) in Cursor

**Not verified.** On 2026-11-11 the pages that the Cursor documentation index lists for skills, rules and subagents
all returned "not found" when fetched, so nothing below is confirmed from a current page. It rests on the notes above
(dated 2026-11-10) and on how the other tools work.

| Piece | Status |
|---|---|
| Skill location | `.agents/skills`, per the notes above, where the kit installs `wk-run-factory`, its `references/` and the scripts. |
| Starting it | Unknown. Whether a skill can be made hand-start only, and how a user starts one, was not confirmed. The skill's first lines tell the agent not to run unless the user asked. |
| Subagents | Unknown. The kit assumes none, so the factory runs in single-agent mode ("Without subagents" in the skill). |
| Hosts | GitHub and GitLab, as in Claude Code; the scripts are plain Node. |

Re-check Cursor's documentation before relying on any of this.
