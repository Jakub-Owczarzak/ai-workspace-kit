# Config checks

Tools that test how a project's assistant is **configured**: its skills, its `CLAUDE.md` imports and the size
of what is loaded every session. The playbook this kit follows says the configuration that steers the agent
deserves the regression testing that code gets. These checks are the local, cheap version of that.

Install by copying `templates/scripts/` (the `*.mjs` files, not the tests) into the project's `scripts/`
folder. They need Node 22+ and no packages.

## The commands

| Command | What it checks | Needs Claude? |
|---|---|---|
| `node scripts/check-config.mjs` | Runs the three checks below in one go; exit 1 on a skill error or a missing import | No |
| `node scripts/check-skills.mjs` | Every skill folder is well formed | No |
| `node scripts/check-imports.mjs` | Every `@path` import in `CLAUDE.md` points to a file that exists | No |
| `node scripts/doc-size.mjs` | How much text is loaded at the start of every session; a soft warning above a limit | No |
| `node scripts/run-claude-checks.mjs --yes` | Asks Claude whether imports were loaded and which skill each trigger phrase picks | **Yes, opt-in** |
| `node scripts/workflow-config.mjs` | Prints the resolved workflow profile | No |

Useful flags: `--root <dir>` (check another project), `--skills-dir <dir>` (repeatable; default
`.claude/skills`), `--strict` (skill warnings fail too), `--no-placeholders` (also report leftover `<...>`
in installed skills; do not use it on the kit itself, whose skills are templates).

Add a shortcut to the project's `package.json`: `"check:config": "node scripts/check-config.mjs"`.

## What each check proves, and what it does not

| Check | Proves | Does NOT prove |
|---|---|---|
| Skill lint | The skill has a `SKILL.md` with frontmatter, a `name` equal to its folder, a description under 1024 characters that says when to use it, no broken relative links, valid trigger fixtures, and no near-identical twin | That Claude will **choose** the skill for a real request |
| Import resolver | The file behind every `@path` exists, including imports of imports (up to 5 levels) | That Claude **loaded** it: a broken import fails silently, but a good one is not confirmed either. Run `/memory` in Claude Code to see what is loaded |
| Doc size | The number of characters and the rough token count (characters / 4) of the always-loaded files | That the content is good, or that a smaller file would work better. It never trims |
| Claude runner | The model, asked directly, names the expected skill or lists the expected files | Anything beyond the model's own report. A pass is a good sign; a failure is a prompt to look |

"Structure verified, triggering not verified" is the honest default. Say so in reports until the runner has been used.

## Skill lint rules

Errors fail the run: no `SKILL.md`, no frontmatter, no `name` or `description`, `name` differs from the folder,
description over 1024 characters, a relative markdown link to a missing file, a `triggers.json` that is invalid.

Warnings: a very short description; a description with no "use when" cue; no `triggers.json`; fewer than 3
"should" or 2 "shouldNot" phrases; two skills whose descriptions share 60% or more of their distinctive words
(Claude may not tell them apart); with `--no-placeholders`, a leftover `<PLACEHOLDER>`.

A skill with `disable-model-invocation: true` is started by hand (a slash command), so it needs no cue and no fixtures.

## Trigger fixtures

Each skill keeps `triggers.json` beside its `SKILL.md`:

```json
{
  "should": ["Write a PR description for this branch", "Draft the pull request body from the diff", "..."],
  "shouldNot": ["Open the pull request and push the branch", "Add a changelog entry for this commit"]
}
```

Write them like real requests, in the words a person would use:

- 3 to 5 **should** phrases, phrased differently from each other and from the description.
- 2 to 3 **shouldNot** phrases. The most useful ones are requests a *sibling* skill handles (a PR description
  versus a changelog entry): they test whether the descriptions tell the skills apart.
- When a skill fails to trigger in real use, add that phrase to `should` and fix the description. The fixtures
  are the regression test for descriptions.

Claude Code ignores extra files in a skill folder, so fixtures cost nothing at run time.

## The Claude runner

`run-claude-checks.mjs` is the only check that uses Claude usage, so it is **off by default** (workflow
control `claude.runChecks`) and no hook or CI job runs it.

1. Turn it on: in `.claude/workflow.json` set `"overrides": { "claude.runChecks": true }`, or set
   `CLAUDE_RUN_CHECKS=1` for one command.
2. Preview the cost: run it without `--yes` (or with `--dry-run`). It prints how many calls it would make
   (one per fixture phrase, plus one for imports) and stops.
3. Run it with `--yes`. Add `--model haiku` for a cheaper model, or `--triggers` / `--imports` to run one part.

One run is one sample: the model's answers can differ between runs (a phrase that came back unclear once
came back as a different, correct answer when asked again). Run it again before trusting a single failure,
and treat a phrase that fails repeatedly as the real signal. The report shows what the model said when its
answer named none of the project's skills (often another installed or plugin skill, which is fine for a
"shouldNot" phrase).

For each phrase it sends `claude -p` a request like "Which skill would you load first for: <phrase>? Reply with
only the skill name or NONE", and compares the answer with the fixture. The answers are model reports, so treat
a failure as a pointer, not a verdict. The tests for the runner use a fake model and never call Claude.

## Reading the doc-size report

```
Always loaded at the start of every session:
  CLAUDE.md          2847 chars     54 lines  (CLAUDE.md)
  AGENTS.md         11111 chars    146 lines  (import)
  ...
  total: 22983 characters, about 5746 tokens
Skill list (names and descriptions, in every session): 7 skills, 2318 characters
```

- **Always loaded**: `CLAUDE.md` files, everything they import with `@`, and `.claude/rules/` files with no
  `paths:`. Rules with `paths:` load only when a matching file is touched and are listed separately.
- **Skill list**: each skill's name and description is in every session, which is why descriptions should
  be short and distinct.
- The warning limit is the workflow control `docs.sizeWarnChars` (default 40000, `0` = off). It only reports.
  Large files cost context on every session and go stale; moving long reference sections to files that are read
  on demand is the usual fix, but a project that works well with a large overview can keep it.

## Profiles

All of these read the workflow profile (`docs/workflow-profiles.md`): `static.checks` turns the lint,
resolver and size report on or off, `docs.sizeWarnChars` sets the limit, and `claude.runChecks` gates the runner.

## Optional wiring

The static checks take well under a second and need no network, so they are safe in a pre-commit hook or a CI
job (`node scripts/check-config.mjs`). They are not wired by default, because a failing skill lint should not
block a one-line fix in a solo project; wire them when the profile is `team` or `org`.
