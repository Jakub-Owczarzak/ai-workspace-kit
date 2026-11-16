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

## 3b. Change the setup afterwards (the manager)

After the setup, try the manager the same way. In your tool say: "Read `.claude/workspace-kit/skills/manage-workspace/SKILL.md`
and follow it. Turn on the feature `test-guard` and switch the profile to `team` without installing its extras. Show me
each plan first; my yes covers exactly those two changes." (Cline and Cursor: paste
[config-prompt.md](config-prompt.md) instead if the tool cannot run the skill by name.)

Check, and write down yes or no for each:
- it read the skill and ran **each change as `--dry-run` first**, with the same arguments, before the real command;
- every shell command it ran was `node .claude/workspace-kit/bin/cli.mjs config ...`, a read-only look (`ls`, `cat`,
  `git status`, `git diff`) or one of the kit's check scripts, and it edited no file by hand;
- `node .claude/workspace-kit/bin/cli.mjs config feature list` shows `test-guard` on, the profile is `team`, and
  `setting.plan-mode-default` was **not** installed (you said without the extras);
- it committed nothing.

Then a refusal: turn the factory on (`config feature factory on`), and ask the tool to turn off `pr-protection`. The
program refuses because the factory needs the review gate. It should show you the refusal, **not** add `--cascade` by
itself, edit nothing, and offer `--cascade` as your decision.

No AI tool? In a terminal, `node .claude/workspace-kit/bin/cli.mjs config menu` opens the numbered menu. Check that it
prints a plan before every change, that an empty answer or `n` changes nothing, and that `q` leaves cleanly.

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
| Manager: dry run before each change, only `config` commands, no hand edits, extras not installed when declined | | | | |
| Manager: stopped at a refusal, no `--cascade` of its own | | | | |
| `config menu`: plan before every change, `n` changes nothing, `q` leaves | | | | |

Write yes, no or not tried in each cell, and add a line for every no. Results already filled in are in section 5.

## 5. Results so far

**The manager, Claude Code 2.1.322, Windows 11, 2026-11-14, two scripted `claude -p` sessions** (edit tools denied, so a
hand edit would have shown as a refused call). Session A (test guard on, profile team without the extras): read the skill,
ran each change as `--dry-run` first with the same arguments, ran only `config` commands and read-only looks, edited
nothing, ended with the right state, committed nothing. Session B (turn off `pr-protection` while the factory is on): ran
the dry run, got the refusal, stopped, did not use `--cascade`, named what needs the gate and offered `--cascade`. The
same two sessions were then run on `fable`, `opus` and `sonnet` (2026-11-14): all three read the skill, ran each change
as `--dry-run` first with the same arguments, edited nothing, ended in the right state, and stopped at the refusal
without `--cascade`. Claude models only: this is evidence, not proof, and says nothing about the four tools below.

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

**OpenCode 2.3.0, Windows 11, 2026-11-14 to 2026-11-16, a local model (`Qwen3.8-27B-GGUF` served by Unsloth Studio, no
cost), the React Native starter pack, kit 0.4.0, `solo` profile.** Four sessions by the kit's author, read back from
OpenCode's session store (the sessions' own messages and tool calls, not a summary). One model, one run each, so this is
evidence, not proof. The config manager (0.5.0) was **not** used in any of them.

| Session | What it did | Result |
|---|---|---|
| Setup (OpenCode, `solo`, factory `local`) | Found a half-finished install, compared it with the approved answers, ran a dry run (35 files unchanged), filled in the router skill, `PLAN.md`, `REVIEW.md` and the project overview from real facts, then ran lint, typecheck, tests (58), `check:config` and `apply --dry-run` | Yes. Asked once (how to join the `pre-push` hook), waited, committed nothing, said what it could not fix |
| Variant check, then `pr` mode with browser e2e | Read the current variant from `choices.json`, planned, turned on `skill.e2e-tests` and `check.e2e-shots`, ran Playwright, looked at the screenshot, committed through the hooks after a self-review, pushed and opened PR #29 by hand (not through the factory) | Yes. The user then asked to keep the whole Playwright layer out of the pack (it moved to `.gitignore`, installed with `--no-save`), and asked why the files still showed in `git status` (they were untracked on `main`, because the ignore lines were still in the open PR) |
| Factory, `local`, one bucket (Dialog component) | `preflight` failed (no pending bucket in `PLAN.md`, dirty tree), so it stopped and wrote a stop report; it then committed the earlier install, added the bucket to `PLAN.md`, re-ran `preflight`, built, wrote the handoff, ran `handoff-check`, lint, typecheck, tests (58), recorded a SELF-REVIEW, committed through the hooks and wrote `.claude/factory/pr-2-dialog-component.md` | Yes: nothing pushed or merged, one finding fixed before the commit, the failing `npm run build` was named as already failing at baseline |
| Native e2e with Maestro 2.12.1 on an Android emulator and Expo Go | Set up four flows, installed Expo Go, ran the suite on the device | Partly, see below |

What held: the translation rules (numbered or tool questions, waits for the answer), no edit before the plan was approved,
every check run with its real output, the factory's own stop rule followed, `SELF-REVIEW` stated, and no push without a
request. **For the factory decision (D1 in `PLAN.md`):** the OpenCode run wrote its handoff under `.claude/factory/`
without any block, so the "sensitive file" refusal seen in a headless `claude -p` run is a Claude Code behaviour, not
something every tool does.

What did not hold or needs a note:
- **Maestro:** 2 of 4 flows passed on the first device run (home, theme and language); `components-gallery` passed on a
  later run; `saved-note` passed its first phase and failed its second (after a force-kill the app came back on the
  Components tab, not Home), then the session ended on a server restart. The suite was **not** shown to pass 4 of 4.
  The model first blamed the app for a dead scroll, ran many probes, then retracted it when the user showed the
  emulator had been replaced by a newer image (Pixel 6 API 33 became Medium Phone API 37) and swiped by hand during a
  probe. **The "Known app bug" paragraph it wrote into the starter pack's `AGENTS.md` was never removed** and is wrong.
  Maestro's `assertVisible` also passed for text that was off screen once, so a pass needs the screenshot as well.
- **Kit folder:** in the `pr` session the kit folder in the project lacked files (`rules/`, `stacks/`, `templates/`), so
  `apply` could not run. The model restored it with `init --force` from the npm package at the installed version, after
  checking that the package held no record files. How the files went missing is not known.
- **Two kit findings from the setup session**, both still open: the kit's `pre-push` lines cannot be appended to a hook
  that already reads stdin in a `while read` loop (the model merged them into one loop by hand), and `overview-check`
  reports two paths inside the kit's own rules block (`.claude/agents/` and a bare `/`) on installs without that folder.
- Not run in these four sessions: the manager, `factory.mode: pr` through the factory, Cursor, Codex, Cline. The manager
  was tried on the same model afterwards, see the next block.

**The manager on the same local model (OpenCode 2.3.0, Qwen3.8-27B-GGUF via `unsloth start opencode`, 2026-11-16).** Two
scripted `opencode run` sessions in scratch copies of a team-profile test project with the current kit (push disabled,
edit tools denied, nothing committed). The prompt was the one in [config-prompt.md](config-prompt.md) plus my answers in
advance, because a `run` session cannot ask questions.

| Check | Session A: turn on `changelog` | Session B: turn off `pr-protection` while the factory needs it |
|---|---|---|
| Read the skill completely first | yes | yes |
| `--dry-run` before the change, same arguments | yes | yes (it was refused) |
| Only `config` commands and read-only looks, no hand edit | yes (8 shell calls, 4 reads) | yes (4 shell calls, 4 reads) |
| Right end state, checked by me afterwards | yes: only the changelog skill, `CHANGELOG.md`, the rules block and the two records changed; a second `apply` changes nothing | yes: the tree was unchanged |
| Stopped at the refusal, no `--cascade` of its own | not applicable | yes: showed the refusal, named what needs the gate, did not run `--cascade` |
| Nothing committed | yes | yes |

Limits: one model, one run each, two scenarios. The model could not ask the questions of round 2, so the answers were
given up front; in the first attempt, where they never reached it (see below), it chose a change by itself (`pr-protection
on`, after a clean dry run) instead of stopping, so this model does not wait for an answer it is not given. The
`config menu`, the profile switch and the `--prune` path were not tried with it.

**The whole path on the same model (OpenCode 2.3.0, Qwen3.8-27B-GGUF, 2026-11-16): install, manager, plan, factory,
commit, pull request.** One run in a scratch copy of a small test project (team profile, tool OpenCode), the user
answering each question turn by turn. I checked every result myself afterwards.

| Step | Result |
|---|---|
| Setup skill, 7 turns | Asked in the skill's rounds and waited each time; showed the dry run and waited for my yes; a second `apply` changed nothing; no `CLAUDE.md`; 8 skills in `.agents/skills/` |
| Manager: `factory on pr`, `pr-protection on` | Dry runs first, waited for my yes, only `config` commands; only `workflow.json`, the two records and one script changed; a fresh setup from the same recorded choices gives an identical tree |
| Planner skill, 3 turns | Four questions, an Intent Anchor with its own assumption flagged, one bucket the factory guard accepts |
| Factory `local`, bucket 1 (a `clamp` helper) | Test first (red run shown), handoff written and checked, SELF-REVIEW recorded, one commit through the real hooks, PR text written, nothing pushed |
| Factory `pr`, bucket 2 (an `inRange` helper) | Pushed only the factory branch after `push-check`, opened PR #8 against the default branch, watched CI: `test` and `docs` green on both runs; nothing merged, the default branch unchanged |

Steps a person did: committed the install (the changelog hook needs `CHANGELOG_BUMP` and `CHANGELOG_ENTRY` when there is
no terminal), switched the factory level with the manager, and gave the go-ahead before the push URL was enabled.

Limits and findings: one model, one project, a pure-function task with no UI. The review was a SELF-REVIEW by the same
agent (OpenCode has no separate reviewer), so an independent review was not shown. The model gave a wrong command to undo
`factory on pr` (`factory on local`; the right one is `factory on`). The PR text describes only the last bucket while its
diff also holds the install and the first bucket, because the PR base was the repository's default branch. `config`
rewrote `.claude/workflow.json` from CRLF to LF line endings (a kit bug, not fixed). The model marked a decision it made
itself as confirmed by the user.

Two things that look like kit failures and are not (found while setting this up): a multi-line prompt passed to
`opencode2.cmd` on Windows reaches the model as its first line only, so give `opencode run` a single-line prompt or an
attached file; and `unsloth start opencode -- run ...` fails because the arguments land on the interactive UI, so use
`unsloth start opencode --no-launch` and run `opencode run --standalone` with the environment it prints.

Two things that look like kit failures and are not:
- **Git Bash on Windows:** OpenCode read the working directory from Git Bash's `PWD` (`/tmp/claude/...`) as `C:\tmp\claude\...`
  and failed with `Unexpected server error` as soon as the prompt held an `@` mention. Start OpenCode from PowerShell.
- **`Database is not empty and has no session table`:** the OpenCode Desktop app (2.x) and the npm `opencode-ai` CLI
  (1.x) share `~/.local/share/opencode/opencode.db`. After the desktop app migrates it to the 2.x schema the 1.x CLI
  refuses to open it. Use the CLI bundled with the desktop app (`resources/opencode-cli.exe`) or the app itself; do not
  delete the database.
