# Workspace instructions

The project overview, architecture and conventions are in `AGENTS.md`, imported here so they load at the
start of every session:

@AGENTS.md

## Before planning or changing code

Read the `workspace-router` skill once per session (if installed), then the skill for the area you are
about to change, before proposing or writing anything.

Planning gate: find the value of `planning.gates`: the one in `overrides` of `.claude/workflow.json` if it
sets it, otherwise the profile's default (`solo` off, `team` anchor, `org` full; no file means `solo`);
`node scripts/workflow-config.mjs` prints it. When it is `anchor` or `full`, do not write production code for non-trivial work until `PLAN.md` holds an
Intent Anchor the user approved (use `goal-first-planner`); `full` also needs the success measurements. Routine
work (a tight request, a small blast radius, code the tests already cover) is exempt. Say when you rely on that.

## How to work (rules)

<!-- workspace-kit:rules
Paste the content of the kit's rules here, one heading per rule file, or import them:
  rules/readable-code.md, rules/repo-tidiness.md, rules/docs-fresh.md,
  rules/commit-gate.md, rules/verification.md, rules/test-discipline.md, rules/skill-routing.md
and, only for projects with a design file: rules/ui-change-flagging.md
Remove this comment when done. -->

## Keep permission prompts low (Claude Code)

- Edit files with the Edit and Write tools, not with shell scripts, so edits go through the normal edit path.
- Read, search and list with Read, Grep and Glob, not `cat`, `grep` or `ls`.
- Keep the shell for what has no other way: tests, the dev server, git. Run it once per finished step.

## How the tooling is wired

- **Skills:** `.claude/skills/<name>/SKILL.md`.
- **Rules:** in this file, and in `.claude/rules/` for rules that apply to certain files.
- **Hooks:** commit hook for lint, type check, tests and the changelog entry; push hook blocks the
  protected branch.
