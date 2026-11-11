# Factory spike: what was run and what it showed

The first step of the factory work (a risk spike). A throwaway private GitHub repository was used to test the assumptions the factory
variant depends on. Run on 2026-11-11, Windows 11, `gh` 2.103.3, `gh stack` v0.3.0, Git 2.54, Node 22.19.
No production code was written.

## Verdicts

| # | Assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | `gh stack` works on this account | **Works** | `gh stack init`, `add`, `submit --auto --open`, `sync` all succeeded; a stack of 2 PRs was created |
| 2 | A stack can be created without an interactive editor | **Works, with a workaround** | `submit --auto` skips the editor but gives only auto-generated titles (the commit subjects) and no way to pass a PR body. The body is set afterwards with `gh pr edit <n> --body-file <file>` |
| 3 | CI runs on every layer of a stack | **Works** | With a plain `on: pull_request` workflow, CI ran and passed on PR #1 (base `main`) and PR #2 (base `layer-1`) |
| 4 | An agent can watch CI and read a failure | **Works** | `gh pr checks <n> --watch --interval 5` blocks until the run ends and exits 1 on failure, 0 on success. `gh run view <run-id> --log-failed` printed the failing step and its message |
| 5 | A fix-and-retry loop works on a stack | **Works** | Push a failing commit, see exit 1, push a fix with `gh stack push`, see exit 0. `gh stack sync` afterwards reported the stack up to date |
| 6 | A headless browser screenshot can be made from a shell | **Works** | Playwright 1.65: `npm install` 2.5 s, `playwright install chromium` 36 s, one screenshot 0.75 s; the PNG showed the page correctly |
| 7 | A screenshot can be attached to a PR | **Works in the HTML; not seen in a browser** | The PNG was committed to the branch and linked in the PR body as a `blob/<branch>/<path>?raw=true` URL. GitHub's rendered body (`body_html`) holds an `<img>` with that URL. I did not open the page in a logged-in browser to see the image |
| 8 | Native e2e (Maestro on an Android emulator) | **Not run here, by decision** | No Java, no `ANDROID_HOME`, no Android SDK, `adb` missing, and the Windows hypervisor is off (firmware virtualization is on). The user decided that the kit prepares native e2e as an **optional choice** and the user supplies the platform (Expo, Android Studio, Xcode, a device); the kit is not tested on a device in this round. See `PLAN.md`, decision 11 |
| 9 | GitLab chained MRs with `glab` | **Works** | `glab` 1.130.0, logged in with a token. Two MRs were created: MR 1 `layer-1` into `main`, MR 2 `layer-2` into `layer-1` (`glab mr create --source-branch ... --target-branch ... --yes`). GitLab has no stack object; the chain is only the target branches |
| 10 | CI runs on a chained MR | **Works, after the account was verified** | The first pipelines (MR 1 and MR 2) ended `failed` the instant they were created: no jobs, no `failure_reason`, no YAML errors, a valid config, shared runners online. The user then verified their GitLab identity. Retriggered by empty commits, both MR pipelines ran, including MR 2 whose target is `layer-1`: the job `check` succeeded. The verification is the likely cause (the failures stopped after it, but GitLab never said so) |
| 11 | Watching and reading GitLab CI | **Works** | A `FAIL` marker pushed to `layer-1` made the MR pipeline fail. `glab ci status --wait --compact`, run inside the clone, blocked until the end and exited 1. The job log, read with `glab api projects/<id>/jobs/<job-id>/trace`, holds the failing step and `ERROR: Job failed: exit code 1`, with ANSI codes and section markers to filter out |

## What changes in the plan

- **Bucket 3 (factory core).** Create PRs with `gh stack submit --auto --open`, then set each body with
  `gh pr edit --body-file`. Detect the extension with `gh extension list`; `gh stack` is v0.3.0, so name a minimum
  version and keep the one-PR-per-bucket fallback for repos or accounts without it. Watch CI with
  `gh pr checks <n> --watch`, and read failures with `gh run view <run-id> --log-failed`.
- **Bucket 4 (e2e).** Link screenshots by **commit SHA** (`blob/<sha>/...`), not by branch name: a branch that is
  deleted after a merge would break a branch-name link. Committing PNGs into the feature branch adds binary files
  to the history; a decision for Bucket 4 is whether to use a separate `factory-screenshots` branch instead.
  Check how the image shows in a logged-in browser before relying on it.
- **Native e2e.** Not tested here. It becomes an optional UI-test choice that the kit prepares and the user
  connects to their own platform (see `docs/factory-rehearsal.md`).
- **Bucket 5 (GitLab).** Chained MRs work and CI can be watched, so the stack fallback is feasible. Run `glab`
  from inside the project clone: `glab mr create` reads the git remotes
  of the **current folder**, and `-R <project>` did not override that (it failed with "none of the git remotes ...
  point to a known GitLab host" when run from a folder whose remote was GitHub). Creating MRs with
  `glab api projects/<id>/merge_requests -X POST` was not tried.

## Other things learned

- `npm --prefix <dir> init -y` writes `package.json` into the **current** folder, not `<dir>`. A prefixed install
  (`npm --prefix <dir> install <pkg>`) does go to `<dir>`. Scripts in this kit that create a package should pass the
  folder explicitly.
- `gh repo delete` needs the `delete_repo` scope, which `gh auth login` does not grant by default. A factory that
  creates throwaway repositories cannot clean up after itself without it, so the factory should not create repos.
- `gh pr checks --watch` printed each finished row twice; parse the exit code, not the text.

## How to repeat it

```text
gh extension install github/gh-stack
gh stack init layer-1                      # edit, commit
gh stack add -Am "Layer 2" layer-2
gh stack submit --auto --open
gh pr edit 2 --body-file body.md
gh pr checks 2 --watch --interval 5        # exit code 0 or 1
gh run view <run-id> --log-failed
gh stack push                              # after a fix
```
