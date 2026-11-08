# Figma sync

Project file of the `figma-sync` skill. It has three jobs: settings for the skill, the list of UI changes
not yet drawn, and a log of what was drawn.

**Flag while working:** every user-visible UI change adds ONE row to "Pending changes" in the same turn.
**Before each commit** with pending rows, run the skill (it asks before writing to Figma).

## Settings

| Setting | Value |
|---|---|
| Write target (file key, name) | `<FIGMA FILE KEY>`, "<name>". The skill writes ONLY here. Use a copy of the design until the method is trusted. |
| Original file (read only unless the user says otherwise) | `<FIGMA FILE KEY>`, "<name>" |
| Variable collection | `<name>`, one mode per color scheme, named after the palette keys in code: `<where the palette lives>` |
| Pages | <page names and IDs> |
| Widths | <phone width (one only)>, <tablet>, <web>. A state that only stretches is drawn once. Each in <modes>. |
| Frame names | `Screen / State / Mode / Width` |
| Language | <which languages are drawn> |
| Where the facts are | Texts: `<translation file>`. Sizes, colors, fonts: `<component source and theme file>`. |
| Method, history, decisions | `<plan file, if any>` |

## Pending changes

One row per change, in plain words. Edit the row if the same thing changes again.

| Date | Area | What the user sees now | Type | Where in code | Draw | Figma frames |
|---|---|---|---|---|---|---|

## Synced log

| Date | What | Frames (name, ID) |
|---|---|---|

## Not drawn yet

- <known gaps, so they are not forgotten>
