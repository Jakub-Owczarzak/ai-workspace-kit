# Adapter: OpenCode

Checked against OpenCode's documentation (skills and rules pages) on 2026-11-10.

| Kit piece | Where it goes |
|---|---|
| Skills (`skills/<name>/`) | `.agents/skills/wk-<name>/SKILL.md`. OpenCode searches `.opencode/skills`, `.claude/skills` and `.agents/skills` from the current folder up to the project root, so a Claude Code install in `.claude/skills` is already found. |
| Always-on rules (`rules/*.md`) | One marked block in `AGENTS.md`. OpenCode takes the first of `AGENTS.md` and `CLAUDE.md` it finds, so with both files present only `AGENTS.md` is used. |
| Extra instruction files | The `instructions` array in `opencode.json` can list more files or globs; the kit does not need it. |
| Commit and push hooks | The project's git hooks. OpenCode has no hook system of its own that the kit uses. |

Notes:

- Skill IDs come from the folder path and are case-sensitive. The kit keeps the folder name and the
  `name:` field identical, lowercase and hyphenated, which is what OpenCode recommends.
- `disable-model-invocation: true` hides a skill from the model, as in Claude Code.
- The skill permission system (`allow`, `ask`, `deny`) in `opencode.json` is the project's choice; the kit
  does not write it.
