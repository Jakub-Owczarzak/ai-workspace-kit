# Rule: flag user-visible UI changes for the design

Only for projects that use the `figma-sync` skill.

Whenever a change makes something different **for the person using the app**, add one row to the
"Pending changes" table of the design-sync file (`FIGMA-SYNC.md`) in the same turn. Do not wait for the
end of the session.

- **Flag:** a new screen, state (empty, error, loading, disabled, open, selected), component, dialog,
  icon, text change, color or token change, layout or responsive change.
- **Do not flag:** logic, data, tests, refactors, build and config changes, anything a user cannot see.
- One row per change, in plain words. If the same thing changes again, edit its row.
- A change that removes something already in the design is flagged too (type `removed`).
- Before a commit with pending rows, run the `figma-sync` skill. It shows the plan and asks before it
  writes to Figma.
