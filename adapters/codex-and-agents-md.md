# Adapter: Codex and any tool that reads `AGENTS.md`

`AGENTS.md` at the project root is the closest thing to a shared standard: many assistants read it at the
start of a task.

| Kit piece | Where it goes |
|---|---|
| Project overview | `AGENTS.md` (use `templates/AGENTS.md`). |
| Always-on rules (`rules/*.md`) | Add them to `AGENTS.md`, under a "How to work" heading (or link to files in a `docs/` folder if the file gets long). |
| Skills (`skills/<name>/`) | `.agents/skills/<name>/SKILL.md`, and say in `AGENTS.md`: "Skills are in `.agents/skills/`. When a task matches a skill, read its `SKILL.md` first." |
| Commit hook | The project's git hooks. |

## A tool that reads none of these

Paste the content of the rules into whatever custom-instructions field the tool has. When you want a
skill, open its `SKILL.md` and paste it, or tell the assistant to read it from the path. The skills are
plain markdown, so they work this way too, without automatic triggering.

## Keeping two tools in sync

If two tools each need their own copy of the same rules, write both from one text and run `diff`. The
setup skill does this when you name more than one tool.
