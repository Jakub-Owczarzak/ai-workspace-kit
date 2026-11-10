# Adapter: Codex and any tool that reads `AGENTS.md`

`AGENTS.md` at the project root is the closest thing to a shared standard: Codex, OpenCode, Cursor and Cline
all read it. Codex documentation (skills and customization pages) checked 2026-11-10.

| Kit piece | Where it goes |
|---|---|
| Project overview | `AGENTS.md` (use `templates/AGENTS.md`, or let `wk-write-project-overview` write it from the code). |
| Always-on rules (`rules/*.md`) | One marked block in `AGENTS.md` (`workspace-kit:start rules` ... `workspace-kit:end rules`). Your own text outside the block is never touched. |
| Skills (`skills/<name>/`) | `.agents/skills/wk-<name>/SKILL.md`. Codex reads repository skills from `.agents/skills` (and personal ones from `$HOME/.agents/skills`). `.codex/skills` is the older location. |
| Commit and push hooks | The project's git hooks. |

## A tool that reads none of these

Paste the content of the rules into whatever custom-instructions field the tool has. When you want a
skill, open its `SKILL.md` and paste it, or tell the assistant to read it from the path. The skills are
plain markdown, so they work this way too, without automatic triggering.

## Several tools, one set of rules

The rules are written once, in `AGENTS.md`. Claude Code does not read `AGENTS.md`, so when it is one of the
tools, `CLAUDE.md` gets a marked `@AGENTS.md` import instead of a second copy.
