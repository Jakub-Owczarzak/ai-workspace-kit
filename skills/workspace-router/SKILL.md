---
name: workspace-router
description: Routes tasks in this project to the right skill or document and holds the standing workflow rules (routing protocol, truth order, keeping docs fresh, commit order). Use before planning or changing code in this project, and when unsure which skill applies. Fill in the routing table once per project.
---

# Workspace router

A **router, not a rulebook**. It tells an assistant which skill or document to read for a task, and in
what order things are true. Fill the tables in section 2 for this project (the setup skill does it).

## 0. Routing protocol (mandatory)

1. When a task matches a row in section 2, **read the full skill or document before writing or changing
   anything** in that area. Do not work from the one-line description.
2. If several rows match, read them in the order listed (earlier = more foundational).
3. Never invent an API, config key, command or flag for a library, framework or tool without either the
   skill content you just read, or the library's current official documentation.
4. The project's own manifests and config files (package manifest, lock file, build config) are the
   source of truth for versions and configuration. If a skill or note contradicts them, the files win.
5. The project's overview document (`AGENTS.md` or equivalent) holds the architecture, conventions and
   known quirks. Read it before structural changes.
6. Read each skill once per session, the first time its area comes up. Do not re-read what is already in
   context.

## 1. Standing rules (always on)

- **Keep the docs fresh.** After every change, check which documents describe it (overview, router,
  rules, plan, backlog) and update them in the same turn. Do not wait to be asked. If a file has an
  identical copy elsewhere (for a second tool), copy it over and run `diff` to confirm they match.
- **Flag user-visible UI changes** in the pending list of the design-sync file, in the same turn (only if
  the project uses `figma-sync`).
- **Commit order:** fix lint, type and test errors → run the review → run the design sync (when rows are
  pending) → commit → a human pushes. Details in the project's commit-gate rule.
- **Report verification honestly:** say what was run and what was not.

## 2. Routing tables (fill in)

### 2.1 Workflow skills (from the workspace kit)

| Skill | Use when |
|---|---|
| `goal-first-planner` | Starting a feature or project: find the real goal, agree an Intent Anchor, work in small buckets with checkpoints |
| `write-project-overview` | The project has no `AGENTS.md` overview yet, or the overview may be stale and should be checked and refreshed |
| `readable-fix-plan` | Turning review findings or a bug list into one scannable plan with verified links |
| `thermo-nuclear-code-quality-review` | A deliberately harsh maintainability review: structure, size, spaghetti growth (only when asked) |
| `pr-description` | Writing the pull request text from the real diff (never opens the PR) |
| `changelog-bump` | A commit needs a changelog entry, or a release should bump the version |
| `figma-sync` | UI changes are pending in the design-sync file, or the user asks to align the design with the app |
| `update-workspace-kit` | A change added or improved something reusable (skill, rule, hook script, template), or the user asks to update the kit, pull the latest kit, or check drift |

### 2.2 Project skills (add rows for this project)

| Skill or document | Use when |
|---|---|
| `<name>` | `<when>` |

### 2.3 Documents

| Document | What it holds |
|---|---|
| `AGENTS.md` | Overview: what the project is, stack, commands, architecture, conventions, known quirks |
| `BACKLOG.md` | Open work by release |
| `PLAN*.md` | Goal, buckets and decision log of a piece of work |
| `CHANGELOG.md` | One `## Unreleased` section; entries are added by commits, versions by releases |

## 3. Conflict and truth order (highest wins)

1. The project's files: manifests, config, source code, hooks, CI workflows.
2. The overview document (`AGENTS.md`).
3. Skill content read from disk (section 0).
4. Official live documentation of the libraries in use.
5. This file and memory notes. They can lag behind the code.

## 4. Writing this file

After editing this file, update every copy for other tools and run `diff` on them. They must be identical.
