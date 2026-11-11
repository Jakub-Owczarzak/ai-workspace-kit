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

## The factory (`wk-run-factory`) in Codex

Written from Codex's documentation, read on 2026-11-11. **Not run in Codex by this kit.**

| Piece | What the documentation says, and what the kit does |
|---|---|
| Skill location | Repository skills are read from `.agents/skills`, where the kit installs `wk-run-factory`, its `references/` and the scripts it calls. |
| Starting it | By hand: `$wk-run-factory`, or `/skills`. The kit ships `agents/openai.yaml` in the skill with `policy: allow_implicit_invocation: false`, the documented way to stop Codex from starting a skill on its own. The skill's first lines also tell the agent not to run unless the user asked. |
| Subagents | Codex has them: custom agents are TOML files in `.codex/agents/` with `name`, `description` and `developer_instructions`. **The kit does not write them**, so the factory runs in single-agent mode: one agent does the build and the review as separate passes ("Without subagents" in the skill). The role texts are `templates/agents/factory-builder.md` and `reviewer.md` in the kit folder, and could be ported into `.codex/agents/` by hand (untried). |
| `AGENTS.md` size | Codex reads `AGENTS.md` only up to `project_doc_max_bytes` (32 KiB by default, per the documentation). The kit's size warning (`docs.sizeWarnChars`) defaults to 40,000 characters, so for a Codex project set it lower, for example 30,000, or the end of the file may not be read. |
| Hosts | GitHub and GitLab, as in Claude Code; the scripts are plain Node. |
