# Rule: kit skills were written for Claude Code; translate them

The kit's skills name some Claude Code features. If you are **not** Claude Code, use the stand-in below instead, and say
once that you do.

- **`AskUserQuestion` (multiple-choice question tool).** If your tool has its own question tool (OpenCode does), use it
  with the same questions and options. If it has none, ask as plain text: numbered options, 3–5 questions per round.
  Either way, wait for the answer; never guess one to keep going.
- **Plan mode / `ExitPlanMode`.** Write the plan in the chat (or in `PLAN.md` when the skill says so) and stop until the
  user approves it. Edit no code before approval.
- **Subagents (`factory-builder`, `reviewer`, `.claude/agents/`).** Do the same work yourself as separate passes, as the
  "Without subagents" section of `wk-run-factory` says. Label your own review "SELF-REVIEW": it is not independent.
- **Slash commands (`/wk-<name>`).** Start the skill your tool's way (`$wk-<name>` in Codex, `@wk-<name>` in OpenCode,
  `/` then the skill in Cline), or read `<skills folder>/wk-<name>/SKILL.md` and follow it.
- **Tool names in a skill (`Read`, `Edit`, `Bash`, `Grep`).** Use your tool's equivalent.
- **`CLAUDE.md`** is Claude Code's instruction file. Where a skill says `CLAUDE.md`, use your tool's own instruction file
  (`AGENTS.md` for most tools); do not create a `CLAUDE.md`.
- **Paths starting with `.claude/`** (`.claude/workflow.json`, `.claude/factory/`) are the kit's own data. Keep using
  them; do not move them to a folder of your tool.

A step you cannot do with these stand-ins is reported as skipped, with the reason, not silently dropped.
