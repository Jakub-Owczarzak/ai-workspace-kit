# Review gate

A second reader for every change, with a local gate that can make it mandatory. Everything runs on your
machine: no GitHub call, no CI, no API key.

| Piece | What it is |
|---|---|
| `templates/REVIEW.md` | The checklist, copied to the project root and edited: plan adherence, correctness, proof shown, the kit rules, project-specific checks, what is blocking |
| `templates/agents/reviewer.md` | The `reviewer` subagent (`.claude/agents/reviewer.md`). Fresh context, tools Read, Grep, Glob and Bash. Reports findings; edits nothing |
| `templates/scripts/check-review-gate.mjs` | Records a finished review and checks that the content being pushed has a clean record |
| `templates/hooks/pre-push` | Runs the check after the protected-branch block |
| `rules/commit-gate.md`, step 2 | Tells the assistant when to run the reviewer |
| control `review.mode` | `off`, `advisory`, `required`; solo and team `advisory`, org `required` (see `workflow-profiles.md`) |

## The flow

1. A step is finished and lint, type check and tests pass. The assistant stages the change.
2. `node scripts/check-review-gate.mjs --staged` says whether the staged content already has a clean record.
3. If not, the assistant starts the `reviewer` subagent on the staged diff. It compares the change with
   `PLAN.md` (Intent Anchor, current bucket) and `REVIEW.md`, runs the project's checks, and reports findings
   with `Blocking: <n>` on the last line.
4. The assistant fixes the blocking findings, reviews again, and records the final result:
   `node scripts/check-review-gate.mjs record --blocking <n> --summary "<one line>" --findings-file <report>`.
5. Commit. On push, the pre-push hook looks for a record for the content at the tip of every ref being pushed
   (only the tip, not each commit on the way, and not a branch deletion).

## The record

`.claude/reviews/<tree>.md` (the folder is gitignored; add `.claude/reviews/` to `.gitignore`):

```
Reviewed-tree: <git tree id>
Reviewed-at: <time>
Blocking: <number>
Summary: <one line>

<the reviewer's findings>
```

It names a git **tree**, which identifies the exact file contents. So a review of the staged change still
matches the commit made right after it, and any later edit makes the record stale and needs a new review.

## The modes

| Mode | Before a commit | At push |
|---|---|---|
| `off` | only when asked | nothing |
| `advisory` | the assistant runs the reviewer | a reminder when there is no clean record; the push goes ahead |
| `required` | same | **blocked** when the content at the tip of a pushed ref has no record, or the record has blocking findings |

A person can still push once with `REVIEW_MODE=off git push`. Assistants do not bypass hooks (commit-gate rule).

## What it does not do

- **It does not run on GitHub.** A pull request gets no automatic review. Claude in CI needs an API key and
  bills usage on every push; the kit keeps that out on purpose. You can run `/code-review` on a PR by hand.
- **It does not read or set GitHub branch protection.** Protection is a GitHub setting the owner switches on,
  and GitHub offers it for private repositories only on a paid plan. The pre-push hook blocks direct pushes to
  the protected branch on this machine only.
- **"Read-only" is not a sandbox.** The reviewer has no Edit or Write tool and its instructions forbid
  writing commands, but it has Bash, and Bash can write. Treat this as a reviewer that is told not to
  change anything, not one that cannot.
- **Records are local.** Another machine has its own records, so `required` is a per-machine gate.
- **A record is an attestation, not proof.** The gate checks that `record --blocking 0` was run for this exact
  content. It cannot tell that a reviewer really ran, and the assistant that wrote the change could record 0
  itself. The gate catches forgetting, not cheating; your own reading of the report is the real check.
- **It is a second reader, not a proof.** The reviewer can miss a problem or report a false one, and one run
  is one sample of its quality.
- **It fails open.** If the check cannot run (no git, an empty repository, a crash, `node` missing from the
  hook's PATH) the push goes ahead; a one-line note says why. A `workflow.json` that is not valid JSON makes
  the resolver use the default profile, so an `org` project would fall back to `advisory`; the check prints the
  resolver's warning so this is visible.
- **A hook that rewrites files changes the tree.** If a pre-commit hook (a formatter, `lint-staged`) changes
  files after the review, the committed content is not the reviewed content and the record is stale. Run lint
  and formatting before the review (commit-gate step 1 does), or review once more after the commit and run
  `record` again (with nothing staged it records the commit's content).
- **The thermo-nuclear review is separate.** It judges structure; it does not check the change against the
  plan, and it does not leave a record.

## Install

Copy `templates/REVIEW.md` to the project root, `templates/agents/reviewer.md` to `.claude/agents/`,
`check-review-gate.mjs` and `workflow-config.mjs` to `scripts/`, append the review-gate lines of
`templates/hooks/pre-push` to the project's pre-push hook, and add `.claude/reviews/` to `.gitignore`.
