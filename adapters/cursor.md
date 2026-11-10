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
