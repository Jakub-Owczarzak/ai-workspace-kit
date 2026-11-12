# Rule: verify, and report honestly

- **Check against the real thing.** Names, numbers, behaviour and file paths in code, docs, PR text and plans are checked
  against the code before they are written, not recalled from an earlier conversation.
- **Say what was run, and show the output.** Name the command and its result (type check, lint, tests with a count,
  build, exit status), not only "it passes". If something was not run (a device, a browser, a platform, a real network),
  say so plainly.
- **Never say "tested", "works" or "fixed" for something that was only read or type-checked.** Say "type-checked", "to
  verify", or "not run".
- **Mark guesses as guesses** ("inferred", "likely", "assumed"), and record assumptions where the reader will see them.
- **Own mistakes in the same breath.** If a check shows an earlier statement or action was wrong, say so, say what it
  affects, and fix it. Do not quietly change course.
- **Destructive or hard-to-undo actions** (deleting files or design frames, overwriting data, pushing) need the user's
  approval first, and a check of exactly what will be affected.
