# Workspace kit

A portable set of working rules, skills and templates, taken from the PRINTROOM (InkPress) project and
made independent of its language, framework and assistant tool. Copy it into any project, run one setup
skill, and the project gets the same workflow: clean code, a tidy repository, honest verification, a
commit gate with changelog and version bump, planning, review, pull request text, and optional design
sync.

## What is inside

| Folder | What | Always on? |
|---|---|---|
| `rules/` | Short rules every session follows: `readable-code`, `repo-tidiness`, `docs-fresh`, `commit-gate`, `verification`, `test-discipline`, `skill-routing`, `ui-change-flagging` | Yes (put in the tool's instruction file) |
| `skills/` | Procedures used on demand (below) | No (used when the task matches) |
| `templates/` | Starting files: `AGENTS.md`, `CLAUDE.md`, `BACKLOG.md`, `PLAN.md`, `FIGMA-SYNC.md`, `CHANGELOG.md`, `REVIEW.md` (the reviewer's checklist), `workflow.json`, `agents/` (the `reviewer` subagent), `hooks/` (git hook wrappers), `scripts/` (the checks and the profile resolver, with their tests), `workflows/` | Copied once, then edited |
| `adapters/` | Where each piece goes for Claude Code, Cline, Cursor, and `AGENTS.md` readers | Reference |
| `docs/` | Reference docs. `workflow-profiles.md`: the `solo` / `team` / `org` profiles and the per-control switches (`.claude/workflow.json`). `config-checks.md`: the skill lint, `@` import resolver, doc-size report and the opt-in `claude -p` runner. `test-discipline.md`: the test-first policy (`tests.tdd`) and the test-edit guard hook (`tests.guard`). `project-overview.md`: how the overview skill and `overview-check.mjs` work. `review-gate.md`: the `reviewer` subagent, the review record and the pre-push gate (`review.mode`) | Read when choosing how strict a project's workflow should be, or when checking how the assistant is configured |
| `stacks/` | One folder per framework (now: `expo-react-native`): routing rows for its skills plus its always-on rule, with no project facts | Optional; installed when the project uses that framework |

### Skills

| Skill | Use when |
|---|---|
| `setup-workspace` | Once per project: installs the pieces you choose for the tools you use (asks first, never overwrites) |
| `workspace-router` | Routes a task to the right skill or document; holds the standing workflow rules |
| `goal-first-planner` | Starting a feature: find the real goal, agree an Intent Anchor, work in small buckets with checkpoints |
| `write-project-overview` | Create the `AGENTS.md` overview from the code, or refresh it: a script (`overview-check.mjs`) lists the stale lines, you approve each edit |
| `changelog-bump` | Every commit gets a changelog entry; a release bumps the version (script, tests, hook and workflow templates) |
| `thermo-nuclear-code-quality-review` | A deliberately harsh maintainability review (only when asked) |
| `readable-fix-plan` | Turn findings or bugs into one scannable plan with verified links |
| `pr-description` | Write the pull request text from the real diff (never opens the PR) |
| `figma-sync` | Keep a Figma design aligned with the app: UI changes are flagged as they happen and drawn before the commit |
| `update-workspace-kit` | Keeps a project and the kit repository in step: PUSH ports a reusable skill, rule, hook script or template from the project into the kit (generalized, on a branch, asked first); PULL refreshes the project's kit snapshot and installed skills from the kit's latest version; checks drift |

## How to use it

**Fast way (recommended, one step plus one prompt):**
1. Copy the **whole kit** into the new project as ONE folder: `.claude/workspace-kit/` (everything in one
   place; it is not loaded as skills, so it does not clutter the skill list).
2. Prompt the assistant: *"Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it."*

It finds the kit in that folder, looks at the project, asks four questions, then installs the pieces you
choose: skills go to `.claude/skills/<name>/` (where Claude Code loads them), rules go into `CLAUDE.md`,
templates become the project files, and hooks are wired in. Afterwards keep `.claude/workspace-kit/` as the
source for updates, or delete it.

Other ways: give the kit's path in the prompt and skip the copy, or install by hand (below). Copying only
the `setup-workspace` folder is not enough: without the kit it has nothing to install.

**Why not copy the kit's folders straight into `.claude/`:** Claude Code loads skills only from
`.claude/skills/<name>/`, and does not load `rules/`, `templates/` or `adapters/` from there. One subfolder
keeps the kit together; the setup step puts each piece where it is actually used.

**By hand:** pick pieces from the tables, follow `adapters/<your tool>.md` for the locations, fill the
`<...>` placeholders in the templates, and wire the hook if you want the changelog.

## Design rules behind it

- **Rules are always on, skills are on demand.** Rules are short and apply to every change; a skill is a
  longer procedure used for one kind of task.
- **Procedure and data are separate.** A skill holds the method and no project facts; the project keeps
  its own data in a file the skill reads (for example `figma-sync` and `FIGMA-SYNC.md`, `changelog-bump`
  and `CHANGELOG.md`). That is what makes a skill reusable.
- **Plain markdown first.** Nothing depends on one tool. The adapters only say where files go.
- **Ask before changing, never overwrite.** Installing is additive and shows what it will change.
- **Report honestly.** Verification statements say what was run and what was not.

## What is NOT in the kit

- The Expo/EAS skills themselves (they come from the Claude Code plugin or `expo/skills`), the InkPress
  app rules and the Expo code review. The Expo routing rows and rule ARE here, as the stack pack in
  `stacks/expo-react-native/`. Add your project's own skills to the router's project table.
- Personal settings (`settings.local.json`) and secrets.

## Status and checks

- `changelog-bump` is copied unchanged and its 22 tests pass from this folder
  (`node --test skills/changelog-bump/scripts/changelog.test.mjs`).
- The other pieces are generalized from skills that run in PRINTROOM. They have not yet been installed
  into a second project; the first real install is the test, so expect small fixes.
- `figma-sync` needs the Figma connector and, for first use, a copy of the design file.

## Updating the kit

This kit is a **git repository** (`https://github.com/Jakub-Owczarzak/workspace-kit`), so no project
depends on one machine's folder. The `update-workspace-kit` skill moves changes both ways:

- **Push** (project → kit): it checks a piece is reusable, removes project facts, shows the plan, asks,
  writes it to a branch of the kit, runs the piece's test, and asks before pushing or opening a pull request.
- **Pull** (kit → project): "pull the latest kit" refreshes the project's `.claude/workspace-kit/` snapshot
  and offers to update the installed skills that are behind, without overwriting project facts. The snapshot
  records the kit commit it was taken from in `.claude/workspace-kit/.kit-version`, so drift can be measured.

Install it in a project like any other skill (copy `skills/update-workspace-kit/` to `.claude/skills/` and
fill its Settings table: repository URL, optional local clone, the project's copy of the kit, kit-origin and
project-only pieces). Keep project facts out of the kit.
