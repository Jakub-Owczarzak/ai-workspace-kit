# Design principles, how it was checked, and what is not in the kit

Sections 10 to 12 of the former README: the principles, what was proven and what was not, and what the kit leaves out. Back to the [README](../README.md).

## 10. Design principles

- **Rules are always on, skills are on demand.** Rules are short and apply to every change; a skill is a
  longer procedure used for one kind of task.
- **Procedure and data are separate.** A skill holds the method and no project facts; the project keeps its
  own data in a file the skill reads (`figma-sync` and `FIGMA-SYNC.md`, `changelog-bump` and `CHANGELOG.md`).
- **Plain markdown first.** Nothing depends on one tool. The adapters only say where files go.
- **Ask before changing, never overwrite.** Installing is additive and shows what it will change.
- **Report honestly.** Verification statements say what was run and what was not.
- **Strictness is a setting.** The profile turns controls on or off per project; the default is light.
- **Measure, do not trim.** The size report shows the cost of the always-loaded files and never cuts them.
- **Fail open.** A check that cannot run allows the action and says so; a guard that can wedge a session costs
  more than it protects.
- **Local only.** No CI calls to Claude, no API key, no GitHub calls from the kit's scripts.

## 11. How it was checked, and what is not proven

Numbers are from 2026-11-10 unless a line says otherwise; they change as the kit does.

- **Tests:** `npm test` runs every `*.test.mjs` file in its own process, with a time limit and closed stdin:
  473 tests, all pass (2026-11-11), in CI on Ubuntu, macOS and Windows with Node 18 and Node 22, and locally on Windows.
  None calls Claude. They include real runs in
  throw-away git repositories, a hook run through a symlink, and the installer's collision cases: a skill with
  the same name, a hand-written `CLAUDE.md`, a `settings.json` with comments, a `git-lfs` pre-push hook, and an
  older copy of the kit.
- **Install smoke test** (`scripts/ci-smoke.mjs`): packs the tarball, runs `npx` from it in an empty project,
  runs the installed kit's `apply`, runs it again and checks that nothing changed and that no dev test file was
  shipped. Passes on Windows, Node 18 and 22.
- **CI** (`.github/workflows/ci.yml`) runs both on Ubuntu, macOS and Windows, with Node 18 and 22. All six jobs
  passed on commits `9ce5221` and `acbf13e`, so the installer, the hooks and the settings merge have run green on
  macOS and Linux as well as Windows. Ubuntu and Windows pass on every commit since. **The macOS jobs are
  unreliable:** on some commits no runner picked them up and they sat in the queue until GitHub cancelled them
  (`6481ca0`, `2c5369d`, `e4a94f2`). The repository is private, where macOS minutes are billed at a higher rate;
  the cause is not confirmed. A cancelled macOS job says nothing about the code, so check that all six jobs ran
  before reading a CI result as proof of portability.
- **Skill lint:** 11 skills, 0 errors, 0 warnings. This checks structure only; it does not prove a skill triggers.
- **A real project, on a copy:** `the Expo starter project`, which already had an older kit copy, plain-named
  skills, husky hooks, imported rules and a wired guard hook. `init` refused until `--force`. `apply` replaced
  nothing the project owned, did not add what its hook already ran, and a second run changed nothing. With
  the project's own `node_modules`, its type check and 58 tests gave the same results before and after, and a
  real `git commit` ran through its husky hooks (lint-staged, type check, tests, docs-fresh, changelog) and
  succeeded. The real repository has not been changed.
- **Bugs those runs found, now fixed:** the test-edit guard and nine other scripts did nothing when started
  through a symlink or a Windows short path (the guard let every edit through); a second run kept rewriting a
  hook on a Windows checkout with CRLF line endings; `--force` would have replaced `PLAN.md`.
- **Model-reported checks** (`claude -p`, 2026-11-09, an earlier version of the kit, one sample each): trigger
  fixtures on an installed copy of the kit (38 pass, 0 fail, 4 unclear), the overview skill (7 of 7), the
  planning gate (5 of 5 expected answers). Not re-run since.
- **Reviews:** five reviews by fresh subagents given the `reviewer` instructions (2026-11-09): the review gate
  (twice), the planner changes, the mapping page and the earlier README. The installer, the catalog and the
  setup questionnaire have **not** been reviewed by a fresh reader.
- **Not yet run:** the setup questionnaire in a real AI session (the installer behind it is tested; the asking
  and the wording of the explanations are not); plan mode; a real `git push` through the pre-push hook; the
  installer against a real project on macOS or Linux (CI covers it on throw-away projects only); a release made
  *through* the publish workflow with trusted publishing (as of 2026-11-10 the workflow had only run on the
  v0.1.0 tag, where it correctly skipped publishing because that version, published by hand, was already on npm).

The status of every playbook practice, and how it was checked, is in
[`docs/playbook-mapping.md`](playbook-mapping.md). Known limits: a review record is an attestation (the
assistant that wrote the change can write it); the reviewer has Bash and is told not to change anything, which is
instructions, not a sandbox; the review gate is per machine; the VS Code extension does not read a project's
default plan mode, per the Claude Code docs.

## 12. What is not in the kit

- The Expo/EAS skills themselves (they come from the Claude Code plugin or `expo/skills`), app-specific
  rules and any framework code review. The Expo routing rows and rule ARE here, as the stack pack in
  `stacks/expo-react-native/`. Add your project's own skills to the router's project table.
- Personal settings (`settings.local.json`) and secrets.
- By decision: Claude in CI (evals, pull request review), managed settings, worktrees and parallel sessions,
  Maintain-stage plays, and reading GitHub branch protection (see `docs/playbook-mapping.md`).
- `figma-sync` needs the Figma connector and, for first use, a copy of the design file.
- Cursor `.cursor/rules/*.mdc` files: the always-on rules reach Cursor through `AGENTS.md`, so the kit does not
  write scoped rule files.
- Hook systems other than plain shell hooks (`lefthook`, the Python `pre-commit` tool): the kit prints the lines
  to add instead of editing their configuration.
