# Rule: kit skills were written for Claude Code; translate them

The kit's skills name some Claude Code features. If you are **not** Claude Code, do not look for those features; use the
stand-in below, and say once when you do.

- **`AskUserQuestion` (multiple-choice question tool).** Ask the same questions as plain text: numbered options, one
  round at a time (3–5 questions), then wait for the answer. Never guess an answer to keep going.
- **Plan mode / `ExitPlanMode`.** Write the plan in the chat (or in `PLAN.md` when the skill says so) and stop until the
  user approves it. Do not edit code before approval.
- **Subagents (`factory-builder`, `reviewer`, `.claude/agents/`).** Do the same work yourself as separate passes, as the
  "Without subagents" section of `wk-run-factory` says. Label a review you did yourself "SELF-REVIEW": it is not independent.
- **Slash commands (`/wk-<name>`).** Start the skill the way your tool does (for example `$wk-<name>` in Codex,
  `@wk-<name>` in OpenCode, `/` then the skill in Cline), or read `<skills folder>/wk-<name>/SKILL.md` and follow it.
- **Tool names in a skill (`Read`, `Edit`, `Bash`, `Grep`).** Use your tool's equivalent for reading, editing, running a
  command and searching.
- **Paths starting with `.claude/`** (`.claude/workflow.json`, `.claude/factory/`) are the kit's own data. Keep using
  those paths; do not move them to a folder of your tool.

A skill step you cannot do with the stand-ins (it needs a feature your tool lacks) is reported as skipped, with the
reason, not silently dropped.
