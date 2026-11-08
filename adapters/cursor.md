# Adapter: Cursor

| Kit piece | Where it goes |
|---|---|
| Always-on rules (`rules/*.md`) | `.cursor/rules/<name>.mdc`, one file per rule, each with a short header that sets `alwaysApply: true` and a one-line `description`. |
| Rules for certain files only | Same folder, with `globs:` in the header (for example `src/**/*.ts`) instead of `alwaysApply`. |
| Skills (`skills/<name>/`) | Cursor has no skills folder of its own. Keep them as plain markdown (for example `.agents/skills/<name>/SKILL.md`) and add a rule that says: "For <task>, read `.agents/skills/<name>/SKILL.md` first." Or paste a skill into the chat when you need it. |
| Project overview | `AGENTS.md` at the project root. Cursor reads it, and so do other tools. |
| Commit hook | Same project git hooks. |

Header example for a rule file:

```
---
description: Readable, self-documenting code
alwaysApply: true
---
<content of rules/readable-code.md>
```

Note: check Cursor's current documentation for the exact header fields, which have changed over time.
