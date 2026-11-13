# Workspace kit

[![CI](https://github.com/Jakub-Owczarzak/ai-workspace-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Jakub-Owczarzak/ai-workspace-kit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-workspace-kit)](https://www.npmjs.com/package/ai-workspace-kit)
[![License: MIT](https://img.shields.io/npm/l/ai-workspace-kit)](LICENSE)

A portable set of working rules, skills, templates and checks that make an AI coding assistant (Claude Code
first, other tools through adapters) work the way a careful engineer works: plan before building, keep the
code and the docs true, prove what was done, get a second reader on the change, and ship with a clean history.
Install it with one `npx` command, answer a short questionnaire in your AI tool, and choose how strict it should
be: **solo**, **team** or **org**. It is built to sit beside the skills, hooks and workflows a project already
has, and never overwrites them.

It grew out of day-to-day work with an AI assistant, was made independent of any language or framework, and
was then aligned with Anthropic's
[AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook).

## What you get in each tool

- **Claude Code: the full kit.** Skills, rules, hooks, and the optional factory, which uses separate subagents: a fresh
  builder for each bucket and an independent reviewer who has not seen the conversation.
- **Cursor, Codex, OpenCode, Cline: a reduced version.** The same rules and skills, run by one agent. The setup adds a
  rule that translates the Claude Code features (question tool, subagents, slash commands) into plain steps. The review
  is then the agent checking its own work, labelled `SELF-REVIEW`, and the review gate does not count it as independent.
  A single agent also re-reads the same context every turn, so a factory run costs more tokens than the subagent layout
  (see [Cost](docs/factory.md#cost)).
- **Proven and not proven.** Claude Code and browser e2e were run. OpenCode 1.19.5 was run once (setup, planner and a
  single-agent factory run, on Windows with a free model); Cursor, Codex and Cline were written from their
  documentation and have not been run; native e2e (Maestro) is experimental. The
  [checklist](docs/other-tools-checklist.md) is the short path to find out whether it works for you.

## Quick setup

Needs Node 18 or newer and git. Five minutes, in this order. Commands go in a terminal in your project folder;
the quoted prompts are pasted into your AI tool (Claude Code, Cursor, Codex, OpenCode or Cline) opened on that
same folder.

**1. Install the kit's files** (copies them into `.claude/workspace-kit/` and touches nothing else):

```text
npx ai-workspace-kit init
```

**2. Set up the workspace.** Paste this into your AI tool:

> Read `.claude/workspace-kit/skills/setup-workspace/SKILL.md` and follow it.

The assistant asks which tools and which profile you use (**solo** for one owner, **team** for a few
developers, **org** for strict policies), explains every switchable rule, skill, hook and check in a line or two
together with what it changes in your workflow, shows a dry run, and installs only what you choose. It never
overwrites a file of yours. More in [Install and use](docs/install-and-update.md#8-install-and-use).

**3. Check it.** Paste:

> Run `node scripts/workflow-config.mjs` and tell me which profile is active and what each control is set to.

**4. Plan your first piece of work.** Paste:

> Use the goal-first-planner skill. I want to <describe the goal>. Interview me, then plan it in small buckets.

**5. Optional: let agents carry an approved plan to pull requests** (the [factory](docs/factory.md)).
The setup in step 2 asks about it right after the profile: answer **local** to try it (it builds, tests, reviews and
commits, then stops before any push), or **pr** to let it also push and open the pull requests. The default is no. To
add it later, run step 2 again and answer yes.

Then, with an approved `PLAN.md`, start it by hand with `/wk-run-factory` (Codex: `$wk-run-factory`). It builds,
verifies, reviews and commits each bucket; in `pr` mode it also pushes feature branches, opens the pull requests and
watches CI. It never merges. Details and what is proven: [`docs/factory.md`](docs/factory.md).

**6. Optional: end-to-end tests and screenshots** (works with the factory on or off). Paste:

> Read the `wk-e2e-tests` skill and set `tests.e2e` to `browser` for this project. Tell me what it needs installed
> first.

**Fewer "allow this command?" pop-ups (optional, your responsibility).** Claude Code asks before it runs most shell
commands. You can pre-approve the ones you trust, but that lets an agent run them unasked, so read the warning first:
[`docs/permissions.md`](docs/permissions.md). The kit never writes these settings for you.

## Uninstall

One command takes out everything the setup installed, and nothing else. From the project folder:

```text
node .claude/workspace-kit/bin/cli.mjs uninstall          # a preview: shows what would go, changes nothing
node .claude/workspace-kit/bin/cli.mjs uninstall --yes    # removes it
```

The kit keeps a record of what it installed, so it removes only that: its skills, scripts and rules block, the hook and
`.gitignore` lines it added, and `.claude/workspace-kit/` itself. Your own skills, scripts and hooks are never touched.

Files you changed since the install (a `PLAN.md` you filled in, a `workflow.json` you edited) are kept, and the command
ends with a **prompt** to paste into your AI tool, which goes through them one by one and asks you about each. To remove
those too in one step, run `uninstall --purge --yes`; the preview first says which files git cannot bring back. Details:
[Uninstall](docs/install-and-update.md#uninstall).

<!-- features-summary:start (generated by scripts/make-feature-matrix.mjs; do not edit by hand) -->
## What is on in each variant

Pick a profile (**Solo**, **Team**, **Org**) and say yes or no to the **factory**: six variants. The settings that differ most are below (— means not used without the factory); you can change every one of them.

| Setting | Solo | Team | Org | Factory Solo | Factory Team | Factory Org |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Planning gates (`planning.gates`) | anchor | anchor | full | anchor | anchor | full |
| Test-first policy (`tests.tdd`) | bugs | on | on | bugs | on | on |
| Test-edit guard (`tests.guard`) | off | on | on | off | on | on |
| Independent review before push (`review.mode`) | advisory | advisory | required | advisory | advisory | required |
| Factory: confirm before pushing (`factory.pushConfirm`) | — | — | — | auto | auto | ask |
| Factory: small documentation fixes without a subagent (`factory.fastFix`) | — | — | — | docs | docs | off |
| Factory: an order found in text the builder reads (`factory.untrustedText`) | — | — | — | note | stop | stop |

Every other feature and setting, which ones the factory turns on and locks, and how to switch each one: **[all features and settings by variant](docs/features.md)**.
<!-- features-summary:end -->

## Where to go next

| You want | Read |
|---|---|
| What the kit is, why it exists, the kit at a glance | [docs/concepts.md](docs/concepts.md) |
| The workflow from install to a released change, and the skills | [docs/workflow-steps.md](docs/workflow-steps.md) |
| Solo, team and org: the flow diagrams, who acts and what is enforced, the hard stops | [docs/profile-flows.md](docs/profile-flows.md) |
| The factory (agents carry a plan to pull requests) | [docs/factory.md](docs/factory.md) |
| Install in detail, uninstall, updating the kit | [docs/install-and-update.md](docs/install-and-update.md) |
| Design principles, how it was checked, what is not proven, what is not in the kit | [docs/design-and-evidence.md](docs/design-and-evidence.md) |
| Where each file lives in the kit, and the glossary | [docs/reference.md](docs/reference.md) |
| Using it in Cursor, Codex, OpenCode or Cline | [docs/other-tools-checklist.md](docs/other-tools-checklist.md) |

**See how the workflow runs:** [flow diagrams for solo, team and org](docs/profile-flows.md#the-flow-in-each-profile-what-is-automated-what-needs-you): each step, who does it (you, the assistant or a script), what blocks, and where you decide.

## Status and feedback

`ai-workspace-kit` is on npm. It is an early version (0.x), so expect rough edges (the version is in `package.json`).
To remove everything the kit installed, see [Uninstall](#uninstall). How releases are made:
[`RELEASING.md`](RELEASING.md). What is proven and what is not:
[how it was checked](docs/design-and-evidence.md#11-how-it-was-checked-and-what-is-not-proven).

**Want to contribute?** Open an issue first, then a pull request from a fork: see [CONTRIBUTING.md](CONTRIBUTING.md).

**Trying it and want to tell us how it went?** Open an issue with the *Feedback or a problem* form
([new issue](https://github.com/Jakub-Owczarzak/ai-workspace-kit/issues/new/choose)). It asks which AI tool and
operating system you used and what the installer printed; those details make a report easy to act on.

## Credits

- **The AI-native SDLC playbook**, Louis Claxton, Anthropic, 2026-08-21:
  <https://claude.com/resources/articles/the-ai-native-sdlc-playbook>. The kit's structure follows its plays; the
  quotes on `docs/playbook-mapping.md` are short and attributed.
- Built with Claude Code.
