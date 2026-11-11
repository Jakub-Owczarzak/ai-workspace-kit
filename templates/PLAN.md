# Plan: <name of the piece of work>

Used by the `goal-first-planner` skill. Updated at every checkpoint so a new session can resume. The plan is
updated in the same commit as the work it describes. The `reviewer` subagent reads it (the Intent Anchor and
the current bucket's "Done when") to check a change against what was agreed.

## Intent Anchor

**Goal:** <one or two sentences>

**Success criteria**
- <observable>

**Success measurements** (needed when `planning.gates` is `full`; otherwise delete)
- <metric: baseline → target, and how it is measured>

**Non-goals**
- <what we are not doing in this round>

**Constraints** (the user's own words, copied)
- <deadline, budget, stack, platforms, must-use or must-avoid>

**Assumptions** (not yet verified)
- <assumption>

**Top risks and unknowns**
- <risk>

## Bucket map

| # | Bucket | Output | Status |
|---|---|---|---|
| 1 | <name> | <what you can see or run> | todo |

## Current bucket

(For a factory run, keep one block like this for every pending bucket, each with its "Done when" line; the
factory refuses a bucket that has none. Blocks start with `**Bucket <id>: <name>**`.)

**Bucket N: <name>**
- Goal: <how it serves the Intent Anchor>
- Steps: <numbered, concrete; in code: files to touch>
- Output: <what the user will be able to see or run>
- Done when: <acceptance criteria>
- Verify by: <test, command, demo or review method>
- TDD: <yes | no> (yes when the acceptance criteria are fixed here and a mistake is costly)
- E2E: <yes | no> (yes when the bucket changes what a user sees or does and `tests.e2e` is not off; the factory runs e2e tests and takes screenshots only for `yes`)
- Review focus: <optional: failure modes this plan implies that no step tests>
- Consumes / Produces: <optional: what this bucket needs from earlier buckets and hands to later ones>
- Risks and open questions: <bullets>
- Key decisions: <each with the chosen option, one line why, and the alternative>

## Decision log

| # | Decision | Chosen | Alternatives | Why | Bucket | Confirmed by user |
|---|---|---|---|---|---|---|
