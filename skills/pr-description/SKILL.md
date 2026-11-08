---
name: pr-description
description: Write a pull request description for the current branch from its real diff and commits, as copy-paste Markdown. Use when asked to prepare, write or draft a PR description, PR body or PR summary. Never opens or pushes the PR. Works in any git project.
---

# PR description writer

Produce one pull request description for the current branch, ready to paste into the hosting site
(GitHub, GitLab, Bitbucket). It is written for the reviewers, not for the person asking, so it says what
changed and what to check, not how the work went.

## 1. Gather the facts (read-only)

Run these from the repository root.

- Base branch: use the project's instructions if they name it. Otherwise take the remote's default
  branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`). If still unclear,
  ask once. The commands below say `BASE`.
- `git branch --show-current`: the branch name. If the project's branch names carry a ticket id
  (for example `feat/ABC-123-short-name`), use it in the title.
- `git log --oneline BASE..HEAD`: the commits.
- `git diff BASE...HEAD --shortstat` and `git diff BASE...HEAD --stat`: how big it is and where.
- `git status --short`: uncommitted work. Tell the user if there is any; do not describe it as part of
  the PR unless they say so.
- Read the changed files that decide the wording (new modules, public behaviour, pricing or business
  rules, state), not just the stat. Check names and numbers against the code before writing them.
- If the project keeps a plan or backlog file (`PLAN*.md`, `BACKLOG.md`), its decision log and open
  items are the best source for "Known gaps".
- Do not rely on memory of earlier conversation for facts the diff can confirm.

## 2. Write it

Use this structure. Drop a section that has nothing real to say; never pad.

```
## <TICKET>: <what the PR does, one line>

<2 to 4 sentences: what this changes and why, and the one thing the reader must know
(for example "not run on a device").>

### What's new
**<Feature group>**
- <what a user or developer can now do or see>

### <Behaviour changes that need attention, e.g. pricing or permissions>
<Formula or before/after, with the real numbers.>

### Code organisation
- <new folders, moved files, new modules, new dependencies>

### Dependencies
- <package>: <why>

### Verification
<Exactly what was run and its result: type check, lint, tests (count), build.>

### Known gaps and open items
- <unfinished, assumed, needs design or product sign-off, not tested on a device or platform>

### Test plan
- [ ] <something a reviewer can do and observe>
```

Rules for the content:

- Lead with user-visible behaviour, then code structure. Group by feature, not by file.
- Use the real names from the code (components, functions, constants) in backticks.
- Report verification honestly. Say what was run and the result. If something was not run (a device, a
  platform, a browser), say so under Verification or Known gaps. Never write "tested" for something that
  was only type-checked.
- Name risks and unfinished work instead of hiding them: data not recorded, placeholders, guessed
  values, assumptions.
- Keep sentences short and plain. No filler such as "this PR aims to". No process narrative.
- Keep it as short as the change allows. A small PR gets a few lines and no empty sections.
- Do not invent ticket numbers, links or test results.
- A changelog entry is not part of the description; the commit hook or the release process handles it.

## 3. Deliver it

1. Start the reply with one line naming the audience, for example "Written for: reviewers of ABC-123."
2. Give the description inside a fenced block that uses four backticks and the `markdown` language tag,
   so inner code spans and fences survive copying.
3. If the project's instructions require an attribution line, end the description with it as the last
   line inside the block. Otherwise add none.
4. After the block, add one short note: the site's **Write** tab shows raw Markdown and **Preview** shows
   the formatting.
5. Mention anything the user should decide or fix before opening the PR (uncommitted changes, missing
   verification, unresolved blocking review findings).

## Boundaries

- Read-only: do not commit, push, create the PR, or edit files. Open the PR (for example `gh pr create`)
  only if the user asks, and then use the description as the body.
- Respect the project's protected branches: PRs go from the feature branch to the base branch; never
  push to a protected branch.
- Offer to save the description to a `.md` file if the user wants to preview it locally.
