# Rule: verify, and report honestly

- **Check against the real thing.** Names, numbers, behaviour and file paths in code, docs, PR text and
  plans are checked against the code before they are written. Do not rely on memory of an earlier
  conversation for facts the repository can confirm.
- **Say what was run.** Name the command and its result (type check, lint, tests with a count, build).
  If something was not run (a device, a browser, a platform, a real network), say so plainly.
- **Show the output.** When you report a task done, include the output of the checks (the counts and the
  exit status), not only "it passes". The reader should not have to rerun a command to believe it.
- **Never say "tested", "works" or "fixed" for something that was only read or type-checked.** Say
  "type-checked", "to verify", or "not run".
- **Mark guesses as guesses** ("inferred", "likely", "assumed"). Record assumptions where the reader will
  see them.
- **Own mistakes in the same breath.** If a check shows an earlier statement or action was wrong, say so,
  say what it affects, and fix it. Do not quietly change course.
- **Destructive or hard-to-undo actions** (deleting files or design frames, overwriting data, pushing)
  need the user's approval first, and a check of exactly what will be affected.
