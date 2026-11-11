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

## The factory (`wk-run-factory`) in OpenCode

Written from OpenCode's documentation, read on 2026-11-11. **Not run in OpenCode by this kit.** The documentation
distinguishes OpenCode V1 and V2 (for example, V2 reads `AGENTS.md` only and has no `CLAUDE.md` fallback); check which
one you use.

| Piece | What the documentation says, and what the kit does |
|---|---|
| Skill location | `.agents/skills` is one of the folders OpenCode searches; the kit installs `wk-run-factory`, its `references/` and the scripts there. |
| Starting it | By hand: `@wk-run-factory` in the prompt. `disable-model-invocation: true`, already in the skill, removes it from the model's list of available skills. The documentation does not say whether the model can still call it by name, so the skill's first lines also tell the agent not to run unless the user asked. |
| Subagents | OpenCode has them, with a fresh context: `.opencode/agents/<name>.md` with `description`, `mode: subagent` and `permissions`. **The kit does not write them**, so the factory runs in single-agent mode ("Without subagents" in the skill). The role texts in the kit folder could be ported by hand (untried). |
| Hosts | GitHub and GitLab, as in Claude Code. |
