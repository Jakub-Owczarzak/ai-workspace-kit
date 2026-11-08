---
name: figma-sync
description: Keep a Figma design file aligned with the app after a working session. UI changes are flagged in one pending list while the work happens; at the end of the session, before the commit, this skill turns that list into Figma frames (variables first, light and dark, the project's phone width), verifies them, and moves the rows to a synced log. Use before committing when the pending list has rows, when the user asks to update, sync or align the Figma design with the app, or to set up design sync in a project. Project-agnostic; copy this folder and create the project file described below.
---

# Skill: figma-sync

The app changes faster than the design. This skill stops them drifting apart without scanning the
whole app: every user-visible UI change is written down **when it is made** (one row), and the
session ends with a list that is ready to be drawn.

It needs the Figma tools (the Figma MCP server) and a project file, by default `FIGMA-SYNC.md` at the project root (or wherever the project's instructions say),
which holds three things: **Settings**, **Pending changes** and a **Synced log**. If the file does not
exist, create it from "Setting up a project" below and ask the user for the Figma file key.

## Part 1: flag changes while working (every session)

Whenever a change makes something different **for the person using the app**, add one row to the
**Pending changes** table in the same turn. Do not wait for the end of the session.

Flag: a new screen, state (empty, error, loading, disabled, open, selected), component, dialog, icon,
text change, color or token change, layout or responsive change, a new width behaviour.
Do not flag: logic, data, tests, refactors, build and config changes, anything the user cannot see.

One row per change, short and in plain words:

`| date | area (screen or component) | what the user sees now | type | where in code | modes and widths to draw | Figma frames |`

- `type`: new screen, new state, new component, text, color, layout, removed.
- If the same thing changes again, edit its row. Do not add a second one.
- If a change removes something that is already in the design, flag it too (type `removed`).
- Leave the last column empty. The sync fills it.

## Part 2: sync at the end of the session, before the commit

Run this when the Pending table has rows, after lint, typecheck and tests pass and before the commit.
Never write to Figma without the user's approval of the plan.

1. **Read the settings and the pending rows.** No rows: say "nothing to sync" and stop. Missing
   Figma file key: ask.
2. **Show the plan and ask.** List each row, what will be drawn or changed, in which modes and widths,
   and which file will be written. Ask for approval, and ask before writing to any file other than the
   write target in Settings. Offer to skip rows. A row the user skips stays pending.
3. **Open the file.** Call `create_session` for the target file. Load the Figma skills before the
   first write (`figma-use`, `figma-generate-design`, and `figma-generate-library` for variables) and
   list their names in `skillNames`. Read the file first: pages, variables, styles, existing frames.
4. **Foundation first.** Bind colors to variables. If the file has no variable collection, create one
   from the project's palette (names equal to the code's palette keys, one mode per color scheme).
   If the code's palette differs from the Figma variables, report the difference; do not change
   variables silently (change them only when the user says so).
5. **Build the rows, one at a time.** For each row read the source files named in "where in code"
   and take texts, sizes and colors from them, never from memory. Follow the Settings rules (phone
   width, modes, naming) and `references/figma-recipes.md` (pitfalls, patterns, scripts). Reuse existing
   layers (a logo, a product picture) by cloning them. Update an existing frame in place when the row
   is a text or color change to something already drawn.
6. **Verify each result.** Return the IDs and sizes from every write, check that no text collapsed,
   take a screenshot and compare it with the source, fix what differs, and check again. Run the
   contrast scan from the recipes on what was built and report any failure (the palette may be at
   fault, not the drawing).
7. **Record.** Move each finished row to the Synced log with the frame names and IDs and the date.
   Rows that were skipped or failed stay pending with a note. Update the project's plan file if there is
   one.
8. **Report** in short: what was drawn (names and where), what was not and why, and any difference
   found between the app and the design. Then the commit can go ahead.

## Rules

- The write target is the file named in Settings (a copy while the method is new). Never write to the
  original file unless the user says so for that session.
- Variables for new work. Old frames that use fixed colors are left alone unless the user asks.
- Show each state once. Do not draw a screen again for every width if it only stretches; follow the
  width list in Settings.
- Put a short caption above each example when a frame shows several states. Captions are design
  notes, not app text.
- The app is the source of truth for what a screen looks like. Where the app and the design disagree,
  list it for the user; only change what the user decides.
- Deleting or replacing existing frames needs the user's explicit approval for each deletion, and a
  check of name, size and color mode first. The Figma plugin cannot undo or restore versions; the user
  can, from version history.
- Do not claim a frame matches the app until a screenshot was compared with the source.

## Setting up a project

1. Copy this folder to `.claude/skills/figma-sync/`.
2. Create `FIGMA-SYNC.md` (any path; say where in Settings) with these sections:
   - **Settings**: write target (file key and name), original file key (read only), variable
     collection name, color modes, phone width, other widths, frame naming pattern, source of palette
     in code, where texts live, any extra rules.
   - **Pending changes**: the table above, empty.
   - **Synced log**: a table `date | what | frames (names and IDs)`.
   - **Not drawn yet**: known gaps, so they are not forgotten.
3. Add a rule to the project's instructions: flag every UI change in the Pending table in the same
   turn, and run this skill before each commit that has pending rows.
4. First run: let the skill create the variables and one small frame, and check it by eye before
   the rest.

## Limits

- It works through the Figma plugin API: it can read and write one file at a time, cannot copy layers
  between files, cannot restore versions, and cannot import images from outside Figma.
- Screenshots of the running app are not taken by this skill; it works from the source code. Where the
  source is not enough (a real photo, a generated image), it draws a placeholder and says so.
- A large screen can need several attempts; expect to fix sizing and wrapping after the first screenshot.
