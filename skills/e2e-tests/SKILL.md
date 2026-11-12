---
name: "e2e-tests"
description: "Use when adding, running or fixing end-to-end UI tests, when a change to what users see needs proof, or when a pull request needs screenshots. Reads tests.e2e (off, browser or native) and follows the matching recipe: Playwright in a headless browser, or Maestro against a native platform the user supplies. Works with or without the factory."
---

# End-to-end tests and screenshots

End-to-end (e2e) tests drive the real interface the way a user would. They are slow, so they run for changes that
alter what a user sees or does, not for logic that unit tests already cover.

## 0. Is it on?

Read `tests.e2e` from `node scripts/workflow-config.mjs` (or `overrides` in `.claude/workflow.json`; a missing file
means `off`).

- `off`: do not set anything up and do not run e2e tests. If the user asks for them, say the control is off and
  that they choose `browser` or `native` in `.claude/workflow.json` (the profile never turns it on by itself).
- `browser`: follow `references/browser-playwright.md`. This is proven: it was run on Windows with Playwright 1.65.
- `native` (**experimental**): follow `references/native-maestro.md`. The user supplies the platform (Expo, Android Studio, Xcode or a
  device) and starts it. This path is **written from Maestro's documentation and is not verified on a device**;
  say so in anything you report.

## 1. Which changes need e2e

A change needs it when it makes something different for the person using the app: a new screen or state, a
component, a dialog, a text, colour or layout change, a changed flow. It does not need it for logic, data, config,
refactors or anything a user cannot see (the same line `ui-change-flagging` draws).

In a plan, a bucket says so with an `E2E: yes` line next to its `TDD:` line. Without the line the answer is no.
If a UI change has no such line, say so and ask whether to add e2e coverage; do not decide alone.

## 2. Setup, once per project

Follow the recipe for the kind. Two rules for every kind:

- **Ask before you install anything.** Name the package and the download (for Playwright: about 2 s for the
  package and about 40 s for Chromium the first time) and wait for a yes. A factory builder may add the dependency
  only when the bucket's plan names it.
- **Record the command** in `AGENTS.md`, in the Commands block, on a line that ends with a comment `# e2e`, for
  example `npm run e2e   # e2e`. The factory reads the e2e command from that line.

Keep generated files out of git: add `e2e-out/` to `.gitignore`.

## 3. Write the tests

- One test per user-visible "Done when" item of the bucket. Find elements the way a user does (by role, label or
  text), not by CSS class. Never wait with a fixed sleep; wait for what the user would wait for.
- Each test that shows something new saves a screenshot to `e2e-out/<feature>-<state>.png` (for example
  `login-error.png`). Descriptive names become the alt text in the pull request.
- The test-discipline rule applies: never weaken, skip or delete an e2e test to get to green. If a test looks wrong,
  stop and say why.

## 4. Run and report

Run the project's e2e command from `AGENTS.md`, **with the project root as the working directory** (the commands
there are written for it; `npm --prefix <folder> run e2e` from elsewhere failed with "Missing script"). Report the
real command, the counts and the exit status. A failure
is real until proven otherwise: read the output, fix the code, run again. If the platform is missing (no browser
installed, no emulator running, no device), stop and tell the user exactly what is missing; do not report e2e as
passing, and do not skip it silently. Say "e2e not run" with the reason.

## 5. Screenshots in a pull request

After a passing run, when `scripts/e2e-shots.mjs` is installed:

```
node scripts/e2e-shots.mjs publish --dir e2e-out --subdir <branch name>
```

It puts the PNGs on a separate `factory-screenshots` branch (never on `main` or your feature branch) and prints the
Markdown to paste under Verification in the PR description. Without the script, leave the PNGs in `e2e-out/` and
tell the user where they are. Do not commit screenshots to the feature branch.

## 6. In a factory run

The `run-factory` skill calls this one for buckets marked `E2E: yes` when `tests.e2e` is not `off`. It runs the
project's e2e command after the unit tests pass, publishes the screenshots, and writes the result into the PR body.
A red e2e run is handled like any failing check: fix, verify, review, and count an attempt.

## Never

- Install a dependency, a browser or a CLI without asking (unless the plan names it).
- Call native e2e verified, or say a screenshot was seen in a browser when it was only published.
- Start an emulator, a simulator or a device for the user, or store a credential for one.
