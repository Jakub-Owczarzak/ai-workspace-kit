# Project overview: create it and keep it true

The overview (`AGENTS.md`) is read at the start of every session, so a wrong line costs more than a missing
one. This kit keeps it true with a skill and a script that split the work:

| Piece | Does | Needs Claude? |
|---|---|---|
| `node scripts/overview-check.mjs` | Compares the overview with the project and lists the lines that no longer match. Never edits | No |
| `write-project-overview` skill, create mode | Reads the project and writes `AGENTS.md` from `templates/AGENTS.md`, then runs the check on it | Yes (a normal session) |
| `write-project-overview` skill, refresh mode | Runs the check, reads the lines the script cannot judge, reports a table, and edits only the lines the user approves | Yes (a normal session) |

## What the script checks

| Finding | Meaning |
|---|---|
| `missing-path` | A file or folder written in backticks is not in the project (a path git ignores is skipped; a path may be written as the end of a longer one, and `@/` means `src/`) |
| `missing-script` | `npm run <name>`, `npm test` or `npm start` where `package.json` has no such script |
| `version` | A version written next to a package name (`Expo SDK 58`, `expo-router ~58`, `React 19.3`) is not the start of the version in `package.json` |
| `undocumented` | The overview lists some children of a folder, and a child is missing from the list (tests, `index` files, hidden files, README and LICENSE are not expected in a list) |
| `label` | A planning label such as "bucket 5a" is left in the overview |

Usage: `node scripts/overview-check.mjs [--root <folder>] [--file <overview>] [--strict]`. It always exits 0,
like the doc-size report, unless `--strict` is given and something is found.

## What it cannot check

A sentence about behaviour ("the language dropdown closes on a second press") is only checkable by reading
the code. The skill reads those lines, and in the report says which lines it read and which it could not
confirm. The check is a list of candidates, not a verdict: a finding can be a false alarm (for example a
prose sentence that names a folder in its own words), and a clean run proves only the checkable parts.

## Size

The skill never trims. `node scripts/doc-size.mjs` still measures the always-loaded files and warns above
`docs.sizeWarnChars` (see `config-checks.md`).
