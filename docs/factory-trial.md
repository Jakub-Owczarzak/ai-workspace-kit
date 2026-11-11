# Factory trial on a real project (Bucket 8)

Run on 2026-11-11 on `a real Expo starter repository` (Expo, vitest, husky), on a branch `trial/factory-0.2.0`
cut from `main` (v0.1.3). Profile `team`, `factory.mode: pr`, `tests.e2e: browser`, kit 0.2.0 installed from a clean
`npm pack` tarball with the documented upgrade path. The plan was two buckets: a Settings tab, then a saved
Show/Hide switch for a Home welcome card with the first Playwright e2e tests (`E2E: yes`). The run was done in a
separate Claude Code session started after the agents were installed, so `factory-builder` and `reviewer` were the
**registered** agents. Nothing was merged or deployed. The two pull requests are scratch work, to be closed.

## What ran

| Step | Result |
|---|---|
| Install | `init --force`, `apply`, `apply --force` (the old `check-docs-fresh.mjs`), the pre-push hook chained by hand (the project's hook reads stdin). The project's hooks ran on the install commit |
| Preflight | Refused until the old bucket map in `PLAN.md` was replaced and an e2e command was in `AGENTS.md`; then ready |
| Builders and reviewers | Registered `factory-builder` and `reviewer` agents, two buckets, 0 blocking findings in both reviews |
| Verified by the orchestrator | Bucket 1: lint, types, 58 of 58 tests, `expo export` lists `/settings`. Bucket 2: lint, types, 65 of 65, `npm run e2e` 3 of 3 in Chromium on Windows from a clean `e2e-out/`; two of three screenshots opened and matched the claims |
| Pull requests | #6 (base `trial/factory-0.2.0`) and #7 (base `factory/1-settings-tab-shell`), bodies written from the diff |
| CI | **No CI ran on either PR.** The project's `commit_check` workflow runs only on PRs that target `main`. The CI watch and fix loop were therefore **not exercised** |

Not seen: the builder's test-first failing run (reported by the builder, not observed), the screenshots rendered on
GitHub, anything on a phone (every check was web only).

## Tokens (measured with `scripts/token-probe.mjs` from the session transcripts)

Cost is in input-token equivalents with **assumed** price ratios (cache read 0.1, cache write 1.25, output 5); check
current pricing before relying on it.

| Who | Model turns | First prompt | Last prompt | Processed in total | Cost (equiv.) |
|---|---|---|---|---|---|
| Orchestrator session (planning, run, fixes) | 76 | 63,436 | 178,093 | 10,123,755 | about 1,425,000 |
| Bucket 1 builder | 13 | 20,393 | 39,555 | 449,723 | about 120,000 |
| Bucket 1 reviewer | 5 | 18,789 | 44,383 | 174,446 | about 84,000 |
| Bucket 2 builder | 24 | 21,669 | 72,668 | 1,337,373 | about 312,000 |
| Bucket 2 reviewer | 3 | 19,247 | 37,048 | 93,465 | about 68,000 |
| **Subagents together** | 45 | | | 2,054,007 | about 584,000 |

The four subagents' reported "tokens" (40,748 / 46,428 / 75,321 / 39,864) are about their last prompt, not what they
processed.

What this shows:

1. **The registered agents start at about 19,000 to 22,000 tokens, not 41,000.** That is about half of the
   `general-purpose` agent's prefix, not the 70% to 80% cut estimated in `PLAN.md` before the measurement. The
   prefix is not only the tool list: the builder (6 tools) and the reviewer (4 tools) differ by only about 2,000.
2. **The orchestrator is the largest cost: about 70% of the total in this run.** It made 76 turns, 98% of what it
   processed was cache reads of a context that grew from 63,000 to 178,000 tokens. This session also contains the
   planning interview, so it is not all factory work, but it is the part no agent file can shrink.
3. **A builder's cost follows its number of turns.** The bucket 2 builder (24 turns, a state and UI change plus e2e
   tests) cost 2.6 times the bucket 1 builder (13 turns), mostly by re-reading its prefix each turn.
4. **Reviewers are cheap in turns (3 to 5) but still carry the fixed prefix.** A reviewer's cost is mostly that prefix.

Consequence for Bucket 10: shrinking the subagent prefix helps less than expected; the bigger levers are the
orchestrator's context growth (large reads, long outputs) and builder turn counts.

## Findings that concern the kit

- **A review record no longer matches the tree that is pushed.** The commit hook adds a changelog line and runs
  prettier after the review, so the recorded tree differs from the final one. Under `review.mode: advisory` (team)
  this only reminds; under `required` (org) the pre-push gate would block it. Not run under `required`.
- **The factory needs an e2e command in `AGENTS.md` before preflight passes**, and the setup does not add one. The
  orchestrator committed that line itself.
- **The PRs are chained, not a GitHub "stack".** The session used `git push` and `gh pr create --base ...` (#6 into
  the trial branch, #7 into #6's branch) instead of `gh stack`, because a stack's trunk is the default branch and the
  install commit would have been in the diff. That choice also meant no CI. The kit's `references/github.md` did not
  say that `gh stack init --base <branch>` exists for exactly this case; it does now (fixed after the trial, not
  re-run). So the "stack on GitHub" path was **not** exercised in this trial; it was proven only in the earlier
  scratch rehearsal.
- **`npx <tarball path> init` prints nothing and exits 0 on Windows**, while `npm exec --package=<tarball> -- ... init`
  and the registry's `npx ai-workspace-kit@0.1.1 init` work. Not investigated.
- **Install into a project with an older kit copy** worked with the documented upgrade path; two manual steps were
  needed (the forced script update, the pre-push chain), both reported by `apply`.

## Findings about the project (not the kit)

- With the default pool every vitest file failed in this environment ("Cannot read properties of undefined (reading
  'config')"); `pool: 'vmThreads'` gives 58 of 58. Cause not found. The workaround is on the trial branch only.
- `npm run build` fails: the Expo CLI rejects `--platform web,ios,android`. It predates the trial.
- `SettingsScreen` imports `GallerySection`, which `AGENTS.md` says is deleted with the Components tab.
- `SegmentedControl` has no `aria-checked` on web, so the e2e checks the effect on Home, not the selected option.
- The race fix in bucket 2 (a late load overwriting a choice) has no unit test and was not re-reviewed.
- The Polish texts are unreviewed.

## What this does and does not prove

Proven here: install and upgrade from the tarball on a real project; the registered builder and reviewer agents; a
two-bucket stack with browser e2e and screenshots; the orchestrator re-verifying instead of trusting reports; real
token numbers. **Not proven:** the CI watch and fix loop on this project (no CI ran), native e2e, the `org` profile,
a `required` review gate, any tool other than Claude Code.
