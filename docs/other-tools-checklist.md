# Trying the kit in Cursor, Codex, OpenCode or Cline (a checklist)

The kit's author could run only Claude Code. The four tools below are supported **from their documentation, not from a
run**. If you use one of them, this checklist is the short path to find out whether it works, and what to send back if it
does not. It takes about 20 minutes and uses a throw-away project, so nothing of yours is touched.

Use a scratch git repository with a tiny project (a `package.json` with a `test` script is enough), on a branch, with a remote
you do not mind (or none: use `factory.mode: local`, which never pushes).

## 1. Install and set up

1. `npx ai-workspace-kit init` in the scratch project.
2. In your tool, say: "Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it." Choose your tool, a
   profile (`team` is a good test), and the factory pieces.
3. Check, and write down yes or no for each:
   - the questionnaire was asked and the dry run was shown before anything was installed;
   - the skills appear where the tool looks for them (`.agents/skills/wk-*` for Cursor, Codex and OpenCode,
     `.cline/skills/wk-*` for Cline; see `adapters/` for your tool);
   - `AGENTS.md` has the kit's marked block, and your own `CLAUDE.md` or `AGENTS.md` text is untouched;
   - `node scripts/workflow-config.mjs` prints the profile you chose.

## 2. Start the factory in `local` mode

Set `factory.mode` to `local` in `.claude/workflow.json`, write a two-line plan with `wk-goal-first-planner` (or copy the
plan format from `templates/PLAN.md`: an Intent Anchor, a bucket map, and a bucket block with a "Done when" line), commit
everything except `PLAN.md`, then start the skill **by hand** the way your tool does it:

| Tool | How to start it (from the adapter notes) |
|---|---|
| Codex | `$wk-run-factory` or `/skills` |
| OpenCode | `@wk-run-factory` |
| Cline | type `/` and pick the skill |
| Cursor | not confirmed by the documentation: say what worked |

Check, and write down:
- the tool did **not** start the skill by itself when you only described the plan (the skill pushes code in `pr` mode, so
  this matters; Cline and Cursor have no documented way to make it hand-start only);
- `node scripts/factory-guard.mjs preflight` ran and either passed or gave clear problems;
- it said plainly that it works as a **single agent** (no fresh builder, no independent reviewer) and labelled its review
  "SELF-REVIEW";
- it built the bucket, ran your tests, committed, and wrote `.claude/factory/pr-<id>.md`;
- it pushed nothing.

## 3. What to send back

Open an issue with the *Feedback or a problem* form (it asks for your tool and operating system) and paste:
- your tool and its version, and the answers to the yes/no lines above;
- the output of `node scripts/workflow-config.mjs` and `node scripts/factory-guard.mjs preflight`;
- anything the tool did that the adapter note for your tool says it would not.

Do not paste tokens, keys or private code.
