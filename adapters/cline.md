# Adapter: Cline

| Kit piece | Where it goes |
|---|---|
| Always-on rules (`rules/*.md`) | `.clinerules/` (one file per rule, or one combined file). Cline reads it for every task. |
| Skills (`skills/<name>/`) | `.agents/skills/<name>/SKILL.md`. Tools that follow the shared agents layout read this folder; Cline reads it when the rules point at it. Add a line to the rules: "Skills are in `.agents/skills/`; read a skill's `SKILL.md` before the task it covers." |
| Project overview | `AGENTS.md` at the project root (see `codex-and-agents-md.md`). |
| Commit hook | Same project git hooks as for any tool. |

Notes:

- If the project also uses Claude Code, write the rules text once and use it in both places, then run
  `diff` on the two copies (the docs-fresh rule requires identical copies).
- A skill in `.agents/skills/` is not loaded by Claude Code. If both tools are used, keep the skill in
  `.claude/skills/` and point Cline's rules at that path, or copy it to both and keep them identical.
- The changelog hook path must match where the skill actually lives.
