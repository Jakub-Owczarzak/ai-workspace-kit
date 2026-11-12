# Repository layout and glossary

Sections 13 and 14 of the former README: where each file lives in the kit, and the terms used. Back to the [README](../README.md).

## 13. Repository layout

```text
 workspace-kit/
   README.md                 this file
   package.json LICENSE      the npm package `ai-workspace-kit` (MIT)
   RELEASING.md              how a release is made (a version tag); not shipped in the package
   bin/cli.mjs               the command: init, apply and uninstall
   lib/                      the installer: init, apply, uninstall and its manifest, marked blocks, hooks,
                             settings.json merge, project files, skill renaming, where each tool reads (each with
                             its tests)
   catalog/options.json      every switchable option, explained in plain words (read by the questionnaire)
   rules/                    8 always-on rules: readable-code, repo-tidiness, docs-fresh, commit-gate,
                             verification, test-discipline, skill-routing, ui-change-flagging
   skills/                   12 skills, each with SKILL.md (and triggers.json for the model-invocable ones);
                             run-factory has references/ for GitHub and GitLab, e2e-tests for Playwright and Maestro
   templates/
     AGENTS.md CLAUDE.md PLAN.md REVIEW.md BACKLOG.md FIGMA-SYNC.md CHANGELOG.md workflow.json
     agents/reviewer.md      the reviewer subagent
     agents/factory-builder.md  the builder subagent the factory starts for each bucket
     hooks/                  pre-commit and pre-push wrappers
     workflows/              release_bump.yaml
     scripts/                the checks, the profile resolver and their tests
   docs/                     workflow-profiles, config-checks, test-discipline, project-overview,
                             review-gate, playbook-mapping, setup-prompt, factory, permissions,
                             factory-host-interface, factory-spike, factory-rehearsal, factory-trial, other-tools-checklist,
                             concepts, workflow-steps, profile-flows, install-and-update, design-and-evidence, reference
                             (the guide that used to be the README), diagrams/ (generated SVGs)
   adapters/                 where each piece goes: Claude Code, Codex and AGENTS.md readers, Cursor, OpenCode, Cline
   stacks/expo-react-native/ routing rows and an always-on rule for one framework (optional)
   scripts/                  kit development only, not shipped: run-tests.mjs, ci-smoke.mjs, matrix-install.mjs,
                             make-flow-diagrams.mjs, token-report.mjs (each with its test where it has one)
   .github/workflows/ci.yml  tests and the install smoke test on 3 operating systems and 2 Node versions
   .github/workflows/publish.yml   publishes to npm when a version tag is pushed (guards: the tag matches
                             package.json, the commit is on main, the tests pass)
   .github/ISSUE_TEMPLATE/   the feedback form
```

Test files (`*.test.mjs`) sit beside the code they test. They are kept in the repository for kit development and
are **not** shipped in the package or installed into projects.

| Folder | What | Always on? |
|---|---|---|
| `bin/`, `lib/` | The installer. Copied into the kit folder too, so setup needs no network | No (run during setup) |
| `catalog/` | The explanation of every option; the questionnaire reads it | No (read during setup) |
| `rules/` | Short rules every session follows | Yes (a marked block in the tool's instruction file) |
| `skills/` | Procedures used on demand | No (used when the task matches) |
| `templates/` | Starting files and scripts | Copied once, then yours to edit |
| `adapters/` | Where each piece goes per tool | Reference |
| `docs/` | Reference docs for the profile, the checks, the test policy, the overview skill, the review gate and the playbook mapping | Read when choosing how strict a project's workflow should be |
| `stacks/` | One folder per framework, with no project facts | Optional |

## 14. Glossary

| Term | Meaning |
|---|---|
| **Intent Anchor** | The short agreed statement of goal, success criteria, non-goals, constraints, assumptions and risks that every later step is checked against |
| **Bucket** | A small piece of work that produces something visible or testable and ends at a checkpoint |
| **Checkpoint** | The stop after a bucket: what was done, how it was verified, a drift check, decisions logged |
| **Profile** | `solo`, `team` or `org`: the preset of strictness in `.claude/workflow.json` |
| **Control** | One setting the profile sets (for example `review.mode`); an override or an environment variable can change it |
| **Rule** | A short instruction always loaded into the assistant's context |
| **Skill** | A longer procedure loaded when its task comes up |
| **Subagent** | A helper the assistant starts with a fresh context, here the `reviewer` |
| **Review record** | A small file in `.claude/reviews/` that says which exact contents (a git tree) were reviewed and how many blocking findings remain |
| **Fix mode** | The period during a bug fix when the test-edit guard blocks edits to existing test files |
| **Plan mode** | A Claude Code mode where Claude cannot edit files until you accept a plan |
| **Soft rule / hard stop** | A soft rule is advice the assistant follows; a hard stop is something that blocks (a hook exit code) |
| **Stack pack** | Routing rows and a rule for one framework, kept apart from the general kit |
| **Kit folder** | `.claude/workspace-kit/` in a project: the copy of the kit that `init` writes and the setup reads from. The only place `init` writes |
| **Catalog** | `catalog/options.json`: every switchable option with its one-line explanation and effect; the questionnaire reads it |
| **Marked block** | Text the kit adds to a file you own, between `workspace-kit:start <id>` and `workspace-kit:end <id>` lines. Re-running replaces only the block; removing it removes the kit's part |
| **`wk-` prefix** | The name kit skills get in a project (`wk-pr-description`), so they cannot clash with skills the project already has |
| **Dry run** | `apply --dry-run`: the full report of what would be created, skipped or left to you, with nothing written |
| **Choices file** | The JSON with your answers (`answers.json`); `apply` reads it, and `choices.json` is the record of the last run |
| **Manifest** | `.claude/workspace-kit/manifest.json`: what `apply` created (with a fingerprint of each file's content), which blocks and settings keys it added. `uninstall` removes exactly what it lists |
