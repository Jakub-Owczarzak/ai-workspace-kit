# Plan: factory variant and optional e2e for ai-workspace-kit

Used by the `goal-first-planner` skill. Updated at every checkpoint so a new session can resume. The plan is
updated in the same commit as the work it describes. The `reviewer` subagent reads it (the Intent Anchor and
the current bucket's "Done when") to check a change against what was agreed.

## Resume here (read this first in a new session)

**Where we are (2026-11-11).** Buckets 1 to 7 are done and verified; Buckets 8 to 10 are next (8: real-project trial; 9: final
test round and token report; 10: tuning). Run `npm test` (453 pass) and `node scripts/ci-smoke.mjs` (ok) first.
The token measurement of the registered `factory-builder` and `reviewer` agents is still open: it needs a fresh session in a
project where the kit's agents are installed (they are not registered in a session that started before they existed).

**Branch `feat/factory-variant`.** Buckets 1 to 6 are committed (`e0503ae`). Bucket 7 is **uncommitted** (README, `docs/factory.md`,
`docs/permissions.md`, 4 SVGs, mapping, version 0.2.0). Nothing is pushed, no pull request, no tag, nothing published to npm. Ask
before any of those; do not commit to `main`.

**The user's standing instructions**
- Plan each bucket first and get approval of its key decisions (use `goal-first-planner`); checkpoint after each.
- Do not delete the scratch repos or revoke tokens yet: the user does that after the final tests (see "To clean up").
- The user wants the README updated and new SVG diagrams for the factory variants (Bucket 7).
- The user wants a final test round with a token report, then tuning (Buckets 9 and 10).

**To clean up when the user says the work is concluded (do not do it earlier)**
- GitHub repo `<scratch repo>` (private; 3 open PRs and a `factory-screenshots` branch). Deleting needs
  the `delete_repo` scope: `gh auth refresh -h github.com -s delete_repo`, which the user runs. The spike repo was deleted by them.
- GitLab token (`api` scope, named `<token name>`): the user revokes it. Both GitLab scratch projects are already permanently
  deleted (the group `<gitlab group>` holds only the user's own `<project>`).
- Local scratch folders under `<scratchpad>\` (`rehearsal`, `glrehearsal`, `spike`, `gl`,
  `pwrecipe`, `pw`, `shots`, answers files): safe to delete; nothing in them is needed.

**Environment gotchas that cost time**
- `glab` is installed at `%LOCALAPPDATA%\Programs\glab\glab.exe` and is not on this session's PATH: add it per command
  (`$env:Path += ";$env:LOCALAPPDATA\Programs\glab"`). `glab` must run inside the clone; `-R` does not override that.
- PowerShell: do not redirect stderr of native commands (`2>&1`), quote `jq` expressions with care, and `Set-Location` changes
  the session's working folder (use `Push-Location`/`Pop-Location` in one command, or `git -C`).
- Always filter command output (`Select-Object`, `--jq`, `grep`): one unfiltered `glab api .../runners` call and git's CRLF
  warnings on a first commit each printed thousands of tokens.
- Agent files installed into a project mid-session are not registered as agent types; the rehearsals use `general-purpose`
  subagents that read the installed `.claude/agents/*.md` text.

**Read these, in this order:** this section; the Decision log (rows 1 to 61); `docs/factory-spike.md`,
`docs/factory-host-interface.md`, `docs/factory-rehearsal.md` (what was proven and what was not); `skills/run-factory/SKILL.md`
and its `references/`; `templates/scripts/factory-guard.mjs`.

**Decisions waiting for the user's eyes** (proposed by me, not yet confirmed): 16, 21 to 24, 25 to 28, 35, 37, 38, 39 to 42, 47 to 52, 56 to 61.
Decision 58 changes a shipped script (`check-review-gate.mjs`, additive).

**Token baseline (observed before any tuning).** Each subagent's completion reported `subagent_tokens`. **Measured on 2026-11-11
(see "Token findings" below): that number is about the size of the subagent's last prompt, not the tokens it processed.**

| Work | Subagent runs | Tokens (sum) | Typical run |
|---|---|---|---|
| GitHub rehearsal 1: 2 buckets, 2 red-CI fixes (builders and reviewers) | 8 | about 431,000 | 49,000 to 63,000 each |
| GitHub rehearsal, e2e bucket with one blocking review round | 4 | about 230,000 | 51,000 to 67,000 each |
| GitLab rehearsal: 2 buckets, 1 red-CI fix | 6 | about 320,000 | 50,000 to 58,000 each |
| Documentation fetches (gh stack docs, Maestro docs, four tools' docs) | 3 | about 260,000 | 27,000 / 60,000 / 173,000 |
| **All subagents in this effort** | **21** | **about 1,240,000** | |

The main session's own usage is not in this table. Observations to test in Bucket 9:
1. Every builder or reviewer costs about 50,000 tokens even for a one-line README fix: a large fixed cost per subagent
   (role text, project files, the skill files it is told to read), not work proportional to the change.
2. A red-CI fix cost a builder plus a reviewer (about 100,000) for a four-line change.
3. The documentation fetches were the most expensive single items; their findings are now in `docs/` and `adapters/`.
4. The orchestrating session re-reads large files (the README is about 25,000 tokens) and prints long outputs.

**Token findings (measured 2026-11-11 with `scripts/token-probe.mjs`; the user's concern is spending tokens only where they are needed).**

| Agent and task | Model turns | First prompt | Last prompt | Processed in total | Of which cache reads | Cost, in input-token equivalents (assumed price ratios) |
|---|---|---|---|---|---|---|
| general-purpose builder, a 4-line README fix | 5 | 40,845 | 50,273 | 239,282 | 211,073 | about 63,000 |
| general-purpose reviewer of that fix | 4 | 40,754 | 50,471 | 190,258 | 162,011 | about 58,000 |
| general-purpose builder, a page with e2e tests | 6 | 41,440 | 66,708 | 355,262 | 284,793 | about 131,000 |
| `Explore` agent (read-only tools), reply "ok" | 1 | 25,737 | 25,737 | 25,789 | 0 | about 32,000 |
| `web-fetch` agent (one tool), reply "ok" | 1 | 4,577 | 4,577 | 4,629 | 0 | about 6,000 |

1. **The reported "50,000" is the last prompt's size.** For the README fix the work itself added only about 9,400 tokens to the
   context; **about 41,000 (80%) was there before the agent did anything**: its system prompt, tool definitions, and the skill and
   tool lists of this environment.
2. **That prefix scales with the number of tools.** One tool: about 4,600. A read-only set: about 25,700. All tools (`general-purpose`):
   about 41,000. The rehearsals used `general-purpose` for every builder and reviewer because an agent file installed in the middle of
   a session is not registered (tested: "Agent type not found"). The real `factory-builder` (6 tools) and `reviewer` (4 tools) were
   **never measured**; they may start near 8,000 to 12,000. This is the first thing to measure, in a session started after the agent
   files are in `.claude/agents/`.
3. **Each extra turn re-reads the whole prefix.** The README builder ran 5 turns and read the prefix from cache each time: 211,000 of its
   239,000 processed tokens were cache reads, which cost a fraction of fresh input (the 0.1 ratio is an assumption). Fewer turns matters as
   much as a smaller prefix. Output was small (1,800 tokens).
4. **So the largest waste is the fixed prefix times the number of turns, not the reading of 4 lines.**

Levers, in the order I would try them, each with what it risks:

| # | Lever | Likely effect | Risk or trade-off | Needs the user's decision |
|---|---|---|---|---|
| A | Run the builder and reviewer as the registered, tool-restricted agents (install them before the session starts) | **Measured 2026-11-11 (`docs/factory-trial.md`): first prompt 18,800 to 21,700 instead of 41,000, about half, not the 70% to 80% estimated.** The orchestrator was about 70% of the run's cost (76 turns, context 63,000 to 178,000), so lever F matters more than expected | None for the guarantees; a session restart after setup | No: measure first |
| B | Give the subagent what it needs in the prompt (the diff, the file paths, the exact checklist lines) and ask it to batch tool calls in one turn | Fewer turns, so fewer prefix re-reads; the README fix could take 1 to 2 turns instead of 5 | The prompt gets longer; the agent may skip context it would have found | No |
| C | **Fast path**: for a tiny change (docs only, or at most N changed lines, no logic), the orchestrator does the fix itself and runs the checks; a labeled self-check replaces the reviewer subagent | Removes 100,000+ reported tokens per trivial CI fix | Less independence; a control such as `factory.fastPath` (`off`, `docs`, `small`) with a line limit, and `required` review still stops for a person (decision 53) | **Yes** |
| D | Review once per pushed branch tip (the gate only checks tips) instead of after every commit and fix round | Fewer reviews: 2 instead of 4 in the first GitHub rehearsal | A problem is found later, after more work is built on it | **Yes** |
| E | A smaller model for mechanical work (the Agent tool has a `model` parameter), for example a docs fix | Lower cost, same token count | Lower quality on anything subtle | **Yes** |
| F | Orchestrator hygiene: filter every output, read only the lines needed, use `clean-log`, never print a whole `glab api` list | Less main-session growth | None | No |
| G | Cache research in `docs/` (the four-tool documentation fetch was 173,000) | Avoids repeat research | Cached facts go stale: date them | No |

**Bucket 9: final test round (plan to present and approve first).** Matrix, on fresh scratch repos, from a clean `npm pack` tarball:
- Install and uninstall from the tarball on a new project, for each profile (solo, team, org) and tool selection; the kit's own CI
  on macOS and Linux (needs a branch pushed and a pull request opened: ask the user).
- Paths no run has covered: `prLayout` `single`; the stack fallback without `gh stack`; `factory.mode` `local`;
  `factory.pushConfirm` `ask`; a builder returning `blocked`; a review with blocking findings and the 3-round limit; the CI cap reached
  in a real pipeline; the by-hand restack under `review.mode` `required`; the `--self-review` block in a real push; a plan with a
  bucket missing "Done when"; the `org` profile end to end.
- Prefer the user's real Expo project (`the Expo starter project`, an additional working folder) for the run that is measured, so the
  token numbers are realistic. Native e2e stays unverified unless the user supplies a platform.
- Hand the user a short checklist to try one other tool (Cursor, Codex, OpenCode or Cline) if they want, since none can be run here.

**Token report (Bucket 9 output).** Write a small development script (not shipped), for example `scripts/token-report.mjs`, that
sums token usage from the session transcript and from each subagent's output, and prints Markdown: tokens by role (orchestrator,
builder, reviewer, fixer, researcher), by bucket and by step, the fixed share per subagent, and the top costly outputs. Likely
sources (verify first): the session transcript `~\.claude\projects\<project>\<session-id>.jsonl`
and `<session-id>\subagents\agent-<id>.jsonl` (one per subagent, with a `.meta.json`; the `tasks\*.output` files are empty on this machine;
never print the transcripts, parse them in a script: `scripts/token-probe.mjs` already does the counting),
plus the `<usage>` lines in each subagent's completion notice. Run it on a baseline factory run and keep the report.

**Bucket 10: token tuning (after the report).** Candidates to try, each measured before and after, and kept only if no guarantee
is weakened: skip the reviewer subagent for docs-only or very small fixes but keep a recorded self-check (a policy choice for the user);
let the orchestrator fix an obvious one-line CI failure itself; shorten the role texts and the lists of files a builder must read;
give the builder the exact files to read instead of letting it explore; reuse one reviewer for the fix and the next bucket;
keep the skill files short and move rarely used parts into references; cap printed output (`clean-log`, `--jq`, `Select-Object`);
cache research results in `docs/`. State the trade-off for each in the plan.

**Bucket 10 as approved by the user (2026-11-11).** Approach: keep the orchestrator's context small and its turns few, and let
subagents carry the loops, handing work over through files. Built so far (458 tests pass): `factory-guard.mjs plan-excerpt` (the
anchor and the pending buckets' plans, not the whole `PLAN.md`) and `handoff-check`; the `factory-builder` runs build, checks and
fixes (up to 3 rounds) and writes `.claude/factory/handoff/<bucket>.md`, replying with a few lines; the `reviewer` reads the
handoff and keeps its report short; the `run-factory` skill got a "Keep your own context small" section (batch commands, filter
output, no relaying, no PNG reads unless a "Done when" depends on them, short PR bodies, a fresh session for long plans), and the
orchestrator verifies once per bucket in one batched call. Not built: a verifier subagent, a driver script, `/compact` steps.
Trade-off kept honest: the builder now checks its own work in its loop; the guarantees stay in the reviewer (independent) and the
orchestrator's own single verification.
**The comparison run (same scenario, new session).** Repo clone `<trial clone>`, branch `trial/factory-compare`
from the baseline's start (`trial/factory-0.2.0`) with the new kit files installed and the same approved plan (the baseline's
`PLAN.md`, both buckets back to todo, uncommitted as then). Same model (Sonnet 5.5), same start (`/wk-run-factory` in a fresh
session, no planning in it), the same project commands and profile. Measure the run phase only, with
`node scripts/token-probe.mjs <folder> main <agent ids> --after "<the first run message>"`.
Baseline, run phase only: orchestrator 68 turns, about 1,263,000 input-token equivalents, context 89,800 to 178,100; subagents
(4) about 584,000; **total about 1,847,000**. Caveats: the baseline orchestrator carried the planning (context started at 89,800;
the new one starts near 63,000 plus the plan excerpt), which is intended (lever 1), so report orchestrator turns and cost per turn
separately; one run each, so differences within about 15% are noise; the price ratios are assumed.
**Success (agreed in words by the user: "significantly lower"; thresholds proposed by me, to confirm):** total cost at least 30%
lower than 1,847,000 (at most about 1,290,000), orchestrator turns at most half of 68, **and** the same outcome: two buckets built,
reviews with 0 blocking findings, lint, types and unit tests green, e2e 3 of 3 with screenshots, nothing merged, no guarantee skipped.
If the cost drops but the outcome is worse, it is not a success.
**Needs the user before the run:** close PRs #6 and #7 on `the Expo starter project` and delete the remote branches
`factory/1-settings-tab-shell`, `factory/2-welcome-card-switch` and `factory-screenshots` (the new run uses the same names and a push
would be rejected), and push `trial/factory-compare`.

## Intent Anchor

**Goal:** Add an opt-in **factory** layer to ai-workspace-kit. After the user approves a plan, agents and
subagents build, test, review, commit, push and open a PR, or a stack of PRs for a multi-feature plan. They then
watch CI, and nothing is merged or deployed. E2E testing (browser and native mobile) becomes an optional control
for every profile and for factory.

**Success criteria**
- From an approved `PLAN.md`, one instruction produces a pushed branch or stack with PRs or MRs. Each has a
  description from the diff, plus screenshots for UI changes. No manual step happens between plan approval and
  the open PR.
- A multi-bucket plan gives a stack: `gh stack` on GitHub, chained MRs on GitLab. Where stacking is
  unavailable, it falls back to one PR per bucket.
- CI results are watched. A red run gets a capped number of fix attempts (default 3), then the agent stops and
  reports.
- `factory` and `tests.e2e` are controls in `.claude/workflow.json`. They are layered on solo, team and org, and
  each profile has a preset.
- E2E works with factory off. The user chooses the UI-test kind at setup: none, browser (Playwright), or native
  (Maestro). Screenshots come from the same run. For native the kit only prepares the choice and the way to connect
  the user's own platform (Expo, Android Studio, Xcode, a device); the user supplies and runs that platform.
- On Claude Code the factory uses subagents and hooks. On Cursor, Codex, OpenCode and Cline it runs the same
  steps as one agent, and the README states what is missing there.
- With factory and e2e off, nothing changes for existing users.
- The README, the profile tables and the catalog are updated, and there are new SVG diagrams: factory in solo,
  team and org, and the e2e path. The "assistants never push" wording becomes conditional on factory.
- Tests and the install smoke test pass on all three OSes (Node 18 and 22). Uninstall removes everything added.
- One real project runs the whole flow end to end.

**Non-goals**
- Auto-merge and deploy. A human merges.
- Headless or CI-hosted agents. This round is a local session.
- Hosts beyond GitHub and GitLab. A host interface is left so others can be added.
- Replacing planning. The plan is still agreed with the user first.

**Constraints** (the user's own words, copied)
- "let add to the scope : Non-GitHub hosts, and tools other than Claude Code (adapters come later). and Native mobile e2e. Only browser-based e2e and screenshots. to user will be abel to use the kit with other clients and also add e2e test but as an optiona point in factory vairant also add this e2e test to the solo, team and org and remeber to updata readme and add new svg diagrams for new variations of the variants"
- Plain files plus Node 18+, no dependencies, no API key, and no network calls from the installer.
- Never overwrite user files. Keep the marked blocks and the uninstall manifest.
- Local session with local git, the host CLI (`gh` or `glab`), and a local browser or simulator.

**Assumptions** (not yet verified)
- `gh stack` is available to the user's account. Its preview status is unconfirmed (GitHub's docs page links
  carry a "public-preview" campaign parameter; the page text does not say so).
- GitLab's stacking is weaker, so chained MRs are the fallback.
- Screenshots need a hosting route, since the CLIs can't attach images directly. Plan: commit them to the
  branch, or post them as a comment. Not tested.
- Playwright runs unattended from an agent session (confirmed in the spike). Maestro and native platforms are
  not tested in this round; the native recipe is written from the tool's documentation and marked unverified.
- Factory pushes only feature branches. The pre-push hook that refuses the protected branch stays as the hard
  stop.

**Top risks and unknowns**
- Reversing the "a person pushes" principle across the README, rules and hooks.
- Screenshot attachment, native simulators and GitLab chaining are the least proven pieces.
- An agent reviewing its own work is weak proof, so team and org presets keep the separate reviewer and the
  test-edit guard.
- A runaway loop on red CI, which the retry cap and stop report address.
- Degraded mode on non-Claude tools may overpromise if the README isn't precise.

## Bucket map

Every bucket also updates the catalog, the installer, uninstall and tests for what it adds.

| # | Bucket | Output | Status |
|---|---|---|---|
| 1 | Risk spike | A findings note in `docs/`, with real runs: `gh stack` create and CI behavior, a screenshot attached to a PR, a Playwright screenshot, Maestro on a simulator, a GitLab MR chain. No production code. | done; GitHub and GitLab both proven; native e2e not run here, by decision 11; see `docs/factory-spike.md` |
| 2 | Controls and host interface | `factory.*` and `tests.e2e` in `workflow.json` and the catalog, presets for solo, team and org, a written host interface; `workflow-config.mjs` prints them, with tests | done: 358 tests pass; `docs/factory-host-interface.md`; controls marked planned until Buckets 3 and 4 |
| 3a | Factory guard and rule changes | `scripts/factory-guard.mjs` (preflight, bucket list from the plan, CI attempt counter, stop report) with tests; the commit-gate rule and the router allow a push only under `factory.mode: pr`, feature branches only | done: 392 tests pass, smoke test passes; real preflight run on this repo |
| 3b | Factory skill, builder subagent, rehearsal | A hand-started `factory` skill (`wk-factory`), a fresh-context `factory-builder` subagent per bucket, catalog entries; a live 2-bucket rehearsal on a new scratch repo (the spike repo was deleted by the user) | done: skill, builder agent, catalog and tests (401 pass, smoke ok); live rehearsal on GitHub passed with a red lower layer, a restack and a green stack; results and untested paths in `docs/factory-rehearsal.md` |
| 4a | Screenshot helper and e2e checks | `scripts/e2e-shots.mjs` (SHA-pinned image Markdown for GitHub and GitLab; publish PNGs to a separate `factory-screenshots` branch through a temporary worktree) and guard helpers (the e2e command in AGENTS.md, the `E2E: yes\|no` bucket line), with tests | done: 426 tests pass; live publish to a GitHub scratch repo checked; see `docs/factory-rehearsal.md` |
| 4b | E2E skill, recipes, rule, factory wiring | `e2e-tests` skill: browser (Playwright) recipe, native (Maestro) guide marked unverified on a device; an e2e step in the commit gate; the factory runs e2e for `E2E: yes` buckets and puts screenshots in the PR body; template, planner, catalog and AGENTS template updates. Usable with factory off | done: 431 tests pass; browser recipe proven (Playwright 1.65); live factory run with an `E2E: yes` bucket on GitHub; native guide written from the docs and marked unverified; see `docs/factory-rehearsal.md` |
| 5 | GitLab host | A GitLab adapter: MRs, pipelines through `glab`, chained-MR stacks | done: 441 tests pass; preflight accepts GitLab; `clean-log`; host reference files; live run on gitlab.com (red bottom layer, fix, no-force restack, green); scratch projects deleted; see `docs/factory-rehearsal.md` |
| 6 | Other tools, degraded mode | Single-agent factory flow for Cursor, Codex, OpenCode and Cline, plus updated `adapters/` | done: 451 tests pass; single-agent section, preflight notes, `record --self-review`, Codex hand-start file, five adapter sections written from documentation dated 2026-11-11; a single-agent dry run in `local` mode; none of the four tools run |
| 7 | Docs and diagrams | README sections, profile tables, the rewritten push principle, new SVGs, playbook mapping | done: 453 tests pass, smoke ok; Quick setup chapter first in the README (prompts, no-pop-up settings, responsibility warning), `docs/factory.md`, `docs/permissions.md`, 4 new generated SVGs (factory solo, team, org, e2e), playbook mapping, version 0.2.0 (not tagged or published) |
| 8 | Real-project trial | A full run on a real project, with a short report | done with a gap (2026-11-11; report `docs/factory-trial.md`): two PRs opened on the real repo with registered agents, browser e2e, 0 blocking findings; **no CI ran on them** (the project's workflow only runs for PRs into `main`), so the CI watch and fix loop were not exercised; tokens measured. Setup notes: Decisions: copy of `the Expo starter project` as a new private scratch GitHub repo (A), a small feature with one `E2E: yes` bucket, profile `team`. Done so far: copy at `<trial clone>` (tracked files of the project at `feat/update-workspace-kit`, local git, 2 commits), kit 0.2.0 installed from the tarball with the documented upgrade path (`init`, `init --force`, `apply`, `apply --force` for the old docs-fresh script, the pre-push hook chained by hand), preflight runs. **Changed by the user:** run on the real repo instead (a branch from main): fresh clone `<trial clone>`, branch `trial/factory-0.2.0` (pushed, install committed as 11c38ee, tests 58 of 58 with the vitest workaround, preflight on it was run). The first copy `<trial clone>` (no remote) is obsolete and can be deleted (it was locked by a running process and could not be renamed). A stack's base is `main`, so each PR diff will include the install commit; the PRs are never merged and are closed with the branches at the end. Findings so far: (1) the real project's tests fail with the default vitest pool in this environment (all 10 files, "Cannot read properties of undefined (reading 'config')"; same in the original folder; `pool: 'vmThreads'` gives 58 of 58); cause not found; (2) `npx <tarball path> init` exits 0 and prints nothing on Windows, while `npm exec --package=<tarball> -- ai-workspace-kit init` and the registry `npx ai-workspace-kit@0.1.1 init` work: not yet investigated; (3) the project's own `PLAN.md` still lists unplanned buckets, so preflight refuses until a new plan replaces it |
| 9 | Final test round, with token measurement | Everything re-tested from a clean tarball install, plus the paths no run has covered yet (matrix below), run on a real-sized project; a token report by role, bucket and step | todo |
| 10 | Token tuning | From the Bucket 9 report: change the process to spend fewer tokens, re-run the same scenario, compare before and after, and keep only changes that do not weaken a guarantee | in progress: changes built (458 tests), comparison repo ready (`<trial clone>`, preflight ok), waiting for the user's yes to clean the old remote branches and PRs, then the run in a fresh session (see "Bucket 10 as approved") |

## Current bucket

**Bucket 7: Docs and diagrams** (done 2026-11-11, with the user's decisions: short README section plus `docs/factory.md`; 4 new diagrams; bump to 0.2.0; a Quick setup chapter first, with the no-approval-pop-up settings from the user's own working setup and a warning that the access is the user's responsibility. The next bucket to plan is 8.) Original plan:
- Goal: The README, the profile tables and the SVG diagrams describe the factory, e2e, GitLab and the other tools as
  they now are, with the "assistants never push" wording made conditional on the factory, and every claim marked
  proven or not.
- Consumes: everything in `docs/` written so far (`factory-spike.md`, `factory-host-interface.md`,
  `factory-rehearsal.md`, `workflow-profiles.md`), the adapters, `scripts/make-flow-diagrams.mjs` and its test (the
  solo, team, org and TDD SVGs are generated), `docs/playbook-mapping.md`, and the README sections 1 to 14.
- Produces: new README sections for the factory (what it is, how to start it, the modes, the hosts, what is not
  verified), the controls table and the "where a person is in the loop" table updated, new generated diagrams for
  factory in solo, team and org and for the e2e path (the user asked for these), the playbook mapping updated, and the
  uninstall and layout sections updated for the new files.
- Open questions for the plan: how the diagrams are generated (extend `make-flow-diagrams.mjs`); how long the README
  gets (it is already about 1100 lines: consider a short factory section plus a link to a new `docs/factory.md`); which
  numbers in the README (skills, rules, tests) change; the README's "Status" and version lines; and the final tests the
  user wants before deleting the repos and tokens.

## Decision log

| # | Decision | Chosen | Alternatives | Why | Bucket | Confirmed by user |
|---|---|---|---|---|---|---|
| 1 | How far the agent goes | Push, open PR(s), watch CI, never merge | Stop before push; auto-merge when green | A human still owns the merge | anchor | yes |
| 2 | Where agents run | Local Claude Code session | Headless in Actions; both | Matches the kit's no-key, no-network design | anchor | yes |
| 3 | How factory relates to profiles | A layer on top of solo, team and org | Three new profiles | One strictness setting, one autonomy setting | anchor | yes |
| 4 | Hosts | GitHub and GitLab, plus a host interface | GitLab and Bitbucket; interface only | Second host proves the interface without doubling the work | anchor | yes |
| 5 | Other AI tools | Claude Code full; others run the flow as one agent | All five equal; Claude Code plus one | Avoids promising subagents and hooks the tools lack | anchor | yes |
| 6 | E2E | One optional `tests.e2e` control; Playwright for browser, Maestro for native | Browser only; native only | Works with factory on or off | anchor | yes |
| 7 | CI fix attempts | Default cap of 3 | Other numbers | Bounds a runaway loop | anchor | yes, with the anchor |
| 8 | Spike repo | A throwaway private repo, deleted afterwards | Local bare repo | Stacks and CI need a real remote | 1 | yes |
| 9 | Spike repo cleanup | Left in place: deleting needs the `delete_repo` scope, a token change the user did not approve | Refresh the token scope myself | Widening permissions is the user's call | 1 | pending |
| 10 | PR body with stacks | `gh stack submit --auto --open`, then `gh pr edit --body-file` | Interactive editor | `--auto` has no body option; the editor can't run unattended | 1 | no, proposed for Bucket 3 |
| 11 | Native e2e | A user choice the kit prepares (setup guide, connection points); the user supplies the platform (Expo, Android Studio, Xcode, device); unverified on a device | Test it on this machine; drop native | The machine can't run an emulator, and a native platform is the user's own to provide | 1 | yes |
| 12 | GitLab spike project | Throwaway private project in the user's group, token with `api` scope, revoke afterwards | Skip GitLab | Needed to prove chained MRs and CI | 1 | yes; project deleted; the user keeps the token until Bucket 5 is done, then revokes it |
| 13 | Factory controls | `factory.mode` off/local/pr (default off), `factory.prLayout`, `factory.ciFixAttempts`, `factory.host`, `factory.pushConfirm` | A plain on/off; fewer controls | Opt-in, and `local` gives a stop before any push | 2 | yes |
| 14 | Profile presets for the factory | solo and team: stack, 3 attempts, push `auto`; org: stack, 2 attempts, push `ask` | The same preset everywhere | Many developers and policies in org | 2 | yes |
| 15 | `tests.e2e` default | `off` everywhere; the kit never turns it on itself | `browser` in team and org | It needs a tool installed in the project | 2 | yes |
| 17 | Split Bucket 3 | 3a guard script and rule changes; 3b skill, builder subagent, rehearsal | One bucket | Each part gets its own review and checkpoint | 3 | yes |
| 18 | How the factory starts | By hand only (`disable-model-invocation: true`, `/wk-factory`) | Claude may start it | It pushes code | 3b | yes |
| 19 | Who builds a bucket | A fresh `factory-builder` subagent per bucket; it stops with "blocked" instead of asking | The main session builds | A long plan would fill the main context | 3b | yes |
| 20 | Rehearsal repo | Reuse `<scratch repo>`, close its 2 PRs first | A new repo; skip until Bucket 8 | No second repo to delete | 3b | yes |
| 21 | What "approved plan" means to the guard | Preflight checks the plan is filled in (anchor goal, at least one pending bucket); starting `/wk-factory` by hand is the approval | A marker line in PLAN.md | No template change; the guard cannot see a conversation | 3a | no, proposed |
| 22 | Guard exit codes | `attempt` exits 0 for fix and 1 for stop; `push-check` 1 for protected; `preflight` 1 when not ready | Always 0 | An agent can branch on the code | 3a | no, proposed |
| 23 | Guard in a project | Option `factory-core` (off by default), requires `check.static` for the resolver it imports; its folder `.claude/factory/` is git-ignored | Fold it into the skill option | The installer's generic file mapping, and the script is tested alone | 3a | no, proposed |
| 24 | Push exception wording | The commit-gate rule allows a push only for a user-started factory run in `pr` mode, after `push-check`; a new standing guard says never merge | A hook that blocks pushes | Keeps the rule short; the pre-push hook still refuses the protected branch | 3a | no, proposed |
| 25 | Skill name | `run-factory` (installed `wk-run-factory`), not `factory` | `factory` | The installer rewrites every bare mention of a skill's name to `wk-<name>`, so a skill called `factory` would turn `factory.mode` into `wk-factory.mode` in installed text; tested | 3b | no, a change from decision 18, proposed |
| 26 | Every pending bucket needs a written "Done when" | `preflight` refuses a pending bucket with no plan block or no "Done when" line (`bucketPlanProblems`); the template and the planner say how to write them | Let the factory derive criteria | The factory must not invent acceptance criteria | 3b | no, proposed |
| 27 | Agent installs | `templates/agents/*.md` map to `.claude/agents/` for Claude Code, manual otherwise | One special case per agent | The builder is the second agent | 3b | no, proposed |
| 28 | Rehearsal uses general-purpose subagents carrying the agent files' text | The installed agent files are not registered mid-session | Restart the session | The rehearsal tests the skill and the files' text, not the registration | 3b | no, proposed |
| 29 | Rehearsal repo | A new private repo `<scratch repo>` (the spike repo had been deleted by the user); two PRs left open; deleting it needs the `delete_repo` scope, so it is left for the user | Reuse the spike repo | The user said to create a new one | 3b | yes, the creation; deletion pending |
| 30 | Restack after a lower-layer fix | `gh stack rebase --upstack`, then `gh stack push` | Rebuild the stack | Proven in the rehearsal | 3b | no, proven |
| 31 | Split Bucket 4 | 4a screenshot helper and checks; 4b skill, recipes, rule, factory wiring | One bucket | Each part gets its own checkpoint | 4 | yes |
| 32 | Screenshot storage | A separate `factory-screenshots` branch, written through a temporary git worktree; PR links pinned by commit SHA | On the feature branch; not committed | Keeps binaries out of `main` and feature history | 4 | yes |
| 33 | Which buckets run e2e | An `E2E: yes\|no` line in the bucket plan, like `TDD:`; run only when `tests.e2e` is not `off` | Every bucket; the builder decides | The approved plan decides, not the builder | 4 | yes |
| 34 | Playwright install | The assistant installs it after asking the user once, naming the package and the download | The user installs it | The kit makes no network calls itself; the install is the user's project action | 4 | yes |
| 35 | e2e command location | A line ending `# e2e` in the Commands block of `AGENTS.md`; not in the pre-commit hook | A new control | One source of truth for commands; e2e is slow | 4 | no, proposed |
| 36 | Pushing the screenshots branch under a required review gate | The publish push runs the repository's hooks (never `--no-verify`) with `REVIEW_MODE=off`; the protected-branch stop still applies | `--no-verify`; record a fake review; let org's gate block the push | The branch holds generated images, not code to review; the kit's own documented override, scoped to one push | 4a | yes: the override applies only to that one push's environment; later code pushes use the profile's normal `review.mode` |
| 37 | How the branch is written | A temporary git worktree, an orphan branch on first use (a unique temporary local branch, deleted afterwards), on top of the fetched branch afterwards; the same subfolder is replaced | Commit from the main working tree; plumbing commands | The working tree, branches and `main` stay untouched; tested | 4a | no, proposed |
| 38 | Reading the plan and AGENTS.md | `E2E: yes` is read from the bucket's own block (shared block lookup with the "Done when" check); the e2e command is a line inside a fenced code block ending `# e2e` or `# end-to-end`; `preflight --json` lists `e2e` per bucket | A new control; scanning prose | One place for commands; no false matches from prose; the preflight check for a missing e2e command arrives with the skill in 4b | 4a | no, proposed |
| 39 | The e2e skill | `e2e-tests`, model-invocable (with trigger fixtures); short `SKILL.md` plus `references/browser-playwright.md` (proven) and `references/native-maestro.md` (unverified, gaps listed); installed as `wk-e2e-tests`; requires `check.e2e-shots`; `tests.e2e` requires the skill | Fold into the factory skill; a rule | It works with the factory off, and long recipes load only when needed | 4b | no, proposed |
| 40 | e2e in the commit gate | A sub-bullet under step 1 (numbering kept): run the e2e command when `tests.e2e` is on and the change alters what a user sees; say "e2e not run" and why otherwise | A new numbered step; a hook | One short line; e2e is too slow for a hook | 4b | no, proposed |
| 41 | Factory and screenshots | After a passing e2e run the PNGs are copied to `.claude/factory/shots/<id>/`; at the end `factory-screenshots` is `push-check`ed, listed for the `ask` confirmation, published, and the Markdown goes into the PR body; `local` mode leaves the PNGs local | Publish per bucket | A later bucket cannot overwrite earlier PNGs; one push step to confirm | 4b | no, proposed |
| 42 | Preflight e2e rules | A problem only when an `E2E: yes` bucket meets `tests.e2e` on and no e2e command in AGENTS.md; notes otherwise (what will run, e2e off with a yes bucket, helper missing) | Always require the command | Do not block projects that do not need it | 4b | no, proposed |
| 43 | Native e2e | Unverified on a device, said in the guide, the catalog text and any report; the user supplies the platform | Test it here | Decision 11 | 4b | yes (decision 11) |
| 44 | Restack without `gh stack` (GitLab, and GitHub without the extension) | Merge the layer below into each upper branch, then a normal push; no force-push | Rebase and force-with-lease on `factory/*`; `glab mr rebase` | Keeps the "never force-push by hand" rule with no exception | 5 | yes |
| 45 | How the skill holds two hosts | `references/github.md` (the existing commands, moved) and `references/gitlab.md`; `SKILL.md` keeps the host-neutral loop | Inline sections | Short main file; GitHub text moved, not rewritten | 5 | yes |
| 46 | GitLab scratch project | A new private project in the user's group, deleted through the API afterwards; the user revokes the token | Skip the live run | Needed to prove the commands and the screenshot link form | 5 | yes |
| 47 | CI log cleaning | `factory-guard.mjs clean-log` strips terminal codes, section markers, timestamps and gh/glab prefixes and keeps the last lines; used for both hosts | Read raw logs | Raw traces waste the agent's attention | 5 | no, proposed |
| 48 | Self-managed GitLab | Supported by design (the host name comes from the remote, `factory.host: gitlab`), documented as untested | gitlab.com only | No server to test with | 5 | no, proposed |
| 49 | Staging in a factory run | Stage only the bucket's own files and check `git diff --cached --name-only` before every commit; never `git add -A` blindly | Rely on `.gitignore` | A rehearsal staged another branch's leftover `e2e-out/` files; the reviewer noticed | 5 | no, proposed |
| 50 | Review record after a by-hand restack | With `review.mode` `required` the merge result needs a quick review and record before the push; not tried | Ignore it | The pre-push hook checks the pushed tree | 5 | no, proposed |
| 51 | Deleting the GitLab scratch projects | `DELETE` twice: first schedules, then `permanently_remove=true&full_path=<renamed path>` removes at once; both scratch projects verified gone (404) | Leave them scheduled | The user approved deletion; a scheduled project lingers | 5 | yes (decision 46); the method is mine |
| 52 | GitLab MR bodies and lookups | `glab mr update <branch> --description-file`, `glab mr view <branch> -F json`, `glab ci status --wait --compact -b <branch>`, `glab ci trace <job> -b <branch>` | API calls | Shorter and proven | 5 | no, proven |
| 53 | Review without subagents under `review.mode` `required` | The self-review is recorded and labeled as such, then the factory stops for a human review or approval before any push | Count the self-review | `required` promises a second reader; a self-review is not one | 6 | yes |
| 54 | Long plans without subagents | The skill suggests stopping after a bucket or two and starting a new session; the plan and `.claude/factory/` hold the state | One session for all buckets | Restores part of the fresh-context benefit | 6 | yes |
| 55 | Sources for the adapter notes | Each tool's current documentation, fetched and dated 2026-11-11 | The existing notes only | Subagent and hand-start support were not covered | 6 | yes |
| 56 | Where the role texts live without subagents | The single agent reads `.claude/workspace-kit/templates/agents/factory-builder.md` and `reviewer.md` from the kit folder (always installed by `init`) and follows them as separate passes | Install copies for each tool | No new installed files; the texts are the same ones the subagents use | 6 | no, proposed |
| 57 | The skill refuses to start unprompted | Its first lines say: if the user did not ask for a factory run, do nothing | Rely on `disable-model-invocation` | Not every tool honors it | 6 | no, proposed |
| 58 | Enforcing decision 53 in the gate | `check-review-gate.mjs record --self-review` writes `Self-review: yes` in the header (read from the header block only); `required` blocks it, `advisory` reminds; a record without the flag is unchanged | Text only, in the skill | The dry run showed the gate said `ok` for a self-review; additive, no change for existing records | 6 | no, proposed: please check |
| 59 | Codex hand-start file | `skills/run-factory/agents/openai.yaml` with `policy: allow_implicit_invocation: false`, from Codex's documentation; not run in Codex | Rely on the skill's opening rule only | The documented way to stop implicit use; harmless to other tools | 6 | no, proposed |
| 60 | Wiring the other tools' subagents | Not done: the adapters say Codex (`.codex/agents/*.toml`) and OpenCode (`.opencode/agents/*.md`) have subagents the kit does not write; Cline has `spawn_agent` in CLI and Desktop only; Cursor unverified | Port the builder and reviewer to each format | Cannot be verified here; decision 5 | 6 | yes (decision 5); noted for the user |
| 61 | `AGENTS.md` size for Codex | Documented in the Codex adapter: Codex reads `AGENTS.md` up to 32 KiB by default; the kit's size warning defaults to 40,000 characters, so set it lower for Codex projects | Change the default | A finding from the documentation, not verified in Codex | 6 | no, proposed |
| 62 | Add a final test round and token analysis | Bucket 9 (matrix above, with a token report) and Bucket 10 (tune the process from the report, re-measure) after Buckets 7 and 8 | Skip measurement | The user asked for it; the baseline already shows a large fixed cost per subagent | 9, 10 | yes (the user's request) |
| 63 | How tokens are measured | A development script that parses the session transcript and the subagents' outputs, plus each subagent's reported usage; baseline first, then tuned runs of the same scenario | Estimate by hand | Comparable numbers before and after | 9 | no, proposed |
| 64 | Where the measured run happens | Prefer the user's real Expo project for realistic numbers; the tiny scratch projects understate the cost of reading a real codebase | Scratch projects only | Realistic cost | 9 | no, proposed: ask the user |
| 65 | Progress is saved in `PLAN.md` ("Resume here"), not committed | The next session reads it first; nothing is committed until the user asks | Commit now | Standing rule: commit only when asked | all | yes |
| 66 | What the "50,000 tokens" means | Measured: the last prompt's size, about 80% of it a fixed prefix that scales with the number of tools; the work itself added about 9,400 | Treat it as work done | A measurement of transcripts, not a guess | 9, 10 | yes (the user's concern) |
| 67 | First token-saving step | Measure the real `factory-builder` and `reviewer` agents, registered at session start, against the `general-purpose` baseline (lever A), then apply lever B | Start with the fast path | The cheapest lever with no loss of independence | 10 | no, proposed |
| 68 | Fast path, review once per tip, smaller model (levers C, D, E) | Not built; each weakens independence or quality, so the user decides, with the trade-offs in the table | Build them now | Standing rule: do not weaken a guarantee silently | 10 | pending: the user |
| 16 | New controls are "planned" in the docs until read | Resolve and print now; the skills that read them come in Buckets 3 and 4 | Add them only when used | Keeps Bucket 2 testable alone | 2 | no, proposed |
