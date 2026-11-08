# Stack pack: Expo / React Native

The framework-specific part of the workflow, kept separate from the generic kit. It is the reusable idea
behind PRINTROOM's `rn-workspace` skill, without any app facts.

## What a stack pack is

The kit's `workspace-router` already gives every project the routing protocol, the standing rules and the
truth order. What differs per framework is only:

1. **Which skills exist and when to use them** (routing rows).
2. **A few always-on rules that stop framework-specific mistakes** (for Expo: APIs change every SDK).

A stack pack holds exactly those two things. It holds **no project facts**: what the app is, its state
and its architecture belong in the project's `AGENTS.md`, not in a skill (a skill that carries facts goes
stale and cannot be reused).

## What is inside

| File | What | Where it goes |
|---|---|---|
| `router-rows.md` | Routing rows for the Expo and EAS skills | Paste into the project's `workspace-router` section 2.2 |
| `rules/expo-docs-first.md` | The always-on rule | Import in `CLAUDE.md` (or the tool's always-on file), like the other rules |

## Where the Expo skills come from (pick one)

| Source | How | When |
|---|---|---|
| **Claude Code plugin** (`expo@claude-plugins-official`, skills named `expo:<name>`) | Enabled once for your user (`/plugin`); works in every project, nothing to copy | You use Claude Code on your own machine (the usual case) |
| **Repo-local copy** (`.agents/skills/<name>/`) | `npx skills@latest add expo/skills --skill '*'`, then route to it | The skills must travel with the repo, or other tools (Cline, Codex) or machines need them |

The rows in `router-rows.md` use the short names (`expo-router`); with the plugin they are `expo:expo-router`.

## Install by hand

1. Copy the rows from `router-rows.md` into the router's section 2.2 (remove rows for skills you do not have).
2. Import this pack's rule in `CLAUDE.md` with
   `@.claude/workspace-kit/stacks/expo-react-native/rules/expo-docs-first.md`
   (or copy its text into the tool's always-on file, as the adapters describe).
3. Put the project's own Expo facts (SDK version, router layout, known quirks) in `AGENTS.md`.

`setup-workspace` does these steps when the project has an `expo` dependency.

## Adding another stack

Copy this folder as `stacks/<name>/` (for example `web-react`, `python-api`) and keep the same three
parts: a README, `router-rows.md`, `rules/`. Keep project facts out.
