---
name: "write-project-overview"
description: "Use when the user asks to write, create or generate AGENTS.md or a project overview file from the code, or to check, update or refresh an existing AGENTS.md or overview (its architecture, stack or commands sections) that may be stale or out of date."
---

# Write Project Overview

Creates or refreshes the project overview (`AGENTS.md`): a short snapshot that assistants and people read before
exploring code. Every statement in it must be checked against the project, or marked `(unverified)`.

A script does the checkable part and the model does the rest, so the result does not depend on memory:

- `node scripts/overview-check.mjs` compares the overview with the project (paths, `npm run` scripts, versions,
  forgotten folder entries, leftover planning labels). It reports and never edits. In a project without
  `scripts/overview-check.mjs`, run `.claude/workspace-kit/templates/scripts/overview-check.mjs` with
  `--root .` instead.
- You read the lines it cannot check (what a folder is for, how something behaves) against the code.

## Rules for the overview (both modes)

- **Shape:** the sections of `templates/AGENTS.md` in the kit (`.claude/workspace-kit/templates/AGENTS.md`):
  What it is, Stack, Implemented, Commands, Architecture, Where a new file goes, Root config, Conventions,
  Known quirks, Repo/git/CI, Release, Changelog. Drop an optional section that has nothing to say.
- **Short and dated:** one fact per bullet. `Last updated` carries today's date and what changed.
- **Verified or marked:** check a name, path, number or command against the code before writing it. What you
  could not check gets `(unverified)`. Never write "works" or "tested" for something you only read.
- **No plan labels:** no "bucket 3", ticket numbers or sprint names. State the fact.
- **Do not trim for size.** `node scripts/doc-size.mjs` measures the always-loaded files and only warns.
- **Never delete content on your own.** Moving a statement is fine; removing one needs the user's approval.

## Mode 1: create (no overview exists)

1. **Read the project; do not ask what the files answer:** `package.json` (scripts, dependencies, versions),
   the lock file name, top-level folders and the source tree two levels deep, test and lint config, CI
   workflows, git hooks, `README.md`, `CLAUDE.md`, `.claude/workflow.json`, and the default branch
   (`git symbolic-ref refs/remotes/origin/HEAD`, or the branches you can list).
2. **Ask once** (one round, at most four questions) for what the files cannot say: what the product is and
   for whom, what does NOT exist yet, quirks the user knows, anything you detected that looks wrong.
3. **Write `AGENTS.md`** from the kit template. Take commands from the `package.json` scripts, versions from
   the dependency list, folders from the real tree. Anything still unknown stays a marked `(unverified)`
   line, not a guess.
4. **Check it:** run `node scripts/overview-check.mjs`, fix every finding, and run it again.
5. **Report** in short: sections written, the `(unverified)` lines, the check output pasted as it printed,
   and that `CLAUDE.md` should import the file (`@AGENTS.md`) if it does not yet. Do not commit.

## Mode 2: refresh (an overview exists)

1. **Run the check** and keep its output as the first part of the evidence.
2. **Read the overview against the code** for what the script cannot see: find what changed since the
   `Last updated` date (`git log --since=<date> --name-status`) and compare it with the Architecture,
   Implemented, Commands, Conventions and Known quirks sections. Open the files a statement is about
   before judging it.
3. **Report first, edit nothing.** One table, one row per problem line:
   `line | statement | status (STALE, UNVERIFIED) | evidence | proposed edit`. Lines that match are not
   listed; say how many were checked and by what (script, reading).
4. **Wait for the user's approval, line by line.** Edit only the approved lines. Leave every other line
   untouched, in its place and wording.
5. **Finish:** set `Last updated` to today with what changed, run the check again, and paste both outputs
   (before and after). Do not commit.

## Limits

- The script proves that a path, script or version matches. It cannot prove that a sentence about behaviour
  is true; those lines are your reading, and you say so in the report.
- It reads `package.json`, so it checks scripts and versions only for projects that have one. Other
  projects still get the path, folder-list and label checks.
