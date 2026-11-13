# Trying the kit in Cursor, Codex, OpenCode or Cline (a checklist)

The kit's author could run only Claude Code. The four tools below are supported **from their documentation, not from a
run**. If you use one of them, this checklist is the short path to find out whether it works, and what to send back if it
does not. It takes about 20 minutes and uses a throw-away project, so nothing of yours is touched.

Use a scratch git repository with a tiny project (a `package.json` with a `test` script is enough), on a branch, with a remote
you do not mind (or none: use `factory.mode: local`, which never pushes).

## 1. Install and set up

1. `npx ai-workspace-kit init` in the scratch project.
2. In your tool, say: "Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it." Choose your tool, a
   profile (`team` is a good test), and answer **yes, `local`** to the factory question that follows the profile.
3. Check, and write down yes or no for each:
   - the questionnaire was asked and the dry run was shown before anything was installed;
   - the skills appear where the tool looks for them (`.agents/skills/wk-*` for Cursor, Codex and OpenCode,
     `.cline/skills/wk-*` for Cline; see `adapters/` for your tool);
   - `AGENTS.md` has the kit's marked block, and your own `CLAUDE.md` or `AGENTS.md` text is untouched;
   - `node scripts/workflow-config.mjs` prints the profile you chose.

## 2. Check the translation rule

The skills were written for Claude Code. Setup adds [tool-translation.md](../adapters/tool-translation.md) to your
`AGENTS.md` so your tool knows what to do instead. A test proves the rule mentions every Claude Code feature the skills
name; only you can show your tool follows it. Start `wk-goal-first-planner` the way your tool does (see the table in step
3), and give it this task:

> Plan a small feature for this project: a `--version` flag for a script. Follow the skill, and do not write code yet.

Check, and write down yes or no for each:
- the interview questions came through the tool's own question tool or plain numbered text (3–5 at a time), and the tool **waited** for your answer
  instead of guessing one;
- the tool said **once** that it was using a stand-in, and did not go looking for a question tool or a plan mode;
- **no file was edited** before you approved the plan (check with `git status`);
- it kept `.claude/workflow.json` and `.claude/factory/` where they are, and did not make a `CLAUDE.md`;
- the skill started the way the table in step 3 says.

Then say "proceed", and check that `PLAN.md` holds an Intent Anchor and a bucket map.

## 3. Start the factory in `local` mode

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

## 4. What to send back

Open an issue with the *Feedback or a problem* form (it asks for your tool and operating system) and paste the table
below, filled in, plus:
- your tool and its version, and the answers to the yes/no lines above;
- the output of `node scripts/workflow-config.mjs` and `node scripts/factory-guard.mjs preflight`;
- anything the tool did that the adapter note for your tool says it would not.

Do not paste tokens, keys or private code.

| Check | Cursor | Codex | OpenCode | Cline |
|---|---|---|---|---|
| Version of the tool | | | | |
| Setup: questionnaire, dry run, skills in the right folder, `AGENTS.md` block | | | | |
| Translation: questions asked (own question tool or plain text), waited for the answer | | | | |
| Translation: said once it uses a stand-in | | | | |
| Translation: no file edited before the plan was approved | | | | |
| Translation: no `CLAUDE.md` created, `.claude/` paths kept | | | | |
| Skill started by hand the documented way | | | | |
| Factory ran as a single agent, review labelled SELF-REVIEW, nothing pushed | | | | |

Write yes, no or not tried in each cell, and add a line for every no.

## 5. Results so far

**OpenCode 1.19.5, Windows 11, 2026-11-13, free `deepseek-v4.1-flash-free` model, a throw-away project, `team` profile,
`factory.mode: local`.** One run, by the kit's author, using `opencode run` turn by turn.

| Check | Result |
|---|---|
| Setup: questionnaire asked in rounds and waited for, dry run shown before anything was written, 8 skills in `.agents/skills/`, `AGENTS.md` block and translation rule, no `CLAUDE.md`, no `.claude/settings.json` | yes |
| Translation: numbered options instead of a question tool, said once, waited for the answer | yes |
| Translation: no file edited before the plan was approved; `PLAN.md` ends with an Intent Anchor and a bucket map | yes |
| Skill not started by itself when only the plan was described | yes, but the model then delivered the plan itself under the rules in `AGENTS.md` (tests first, a self-review, a commit, nothing pushed) without the factory skill |
| Skill started by hand with `@wk-run-factory` | yes: it ran `preflight`, `baseline`, `plan-excerpt` and `handoff-check` |
| Factory ran as a single agent, review labelled SELF-REVIEW (`Self-review: yes` in the record), nothing pushed | yes: one commit on `factory/1-version-flag`, `npm test` 5 of 5, PR text in `.claude/factory/pr-1.md`, no remote, no push attempt |

Caveats: the review record named the tree before the commit, and the changelog hook then changed it, so
`check-review-gate` said "no review record for this content" for the committed tree (the known "a hook that rewrites
files changes the tree" limit in [review-gate.md](review-gate.md); advisory here). The run used a small free model, one
session, and OpenCode 1.x, not 2.x. Not run: Cursor, Codex, Cline, OpenCode 2.x, `pr` mode, macOS and Linux.

Two things that look like kit failures and are not:
- **Git Bash on Windows:** OpenCode read the working directory from Git Bash's `PWD` (`/tmp/claude/...`) as `C:\tmp\claude\...`
  and failed with `Unexpected server error` as soon as the prompt held an `@` mention. Start OpenCode from PowerShell.
- **`Database is not empty and has no session table`:** the OpenCode Desktop app (2.x) and the npm `opencode-ai` CLI
  (1.x) share `~/.local/share/opencode/opencode.db`. After the desktop app migrates it to the 2.x schema the 1.x CLI
  refuses to open it. Use the CLI bundled with the desktop app (`resources/opencode-cli.exe`) or the app itself; do not
  delete the database.
