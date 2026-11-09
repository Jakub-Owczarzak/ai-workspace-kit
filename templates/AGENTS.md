# <PROJECT NAME>: overview for assistants and people

> Snapshot of the project: read before exploring code. Last updated: <YYYY-MM-DD> (<what changed>). Update
> it first when a feature or state changes. One fact per bullet; a fact that was not checked against the
> code is marked `(unverified)`; no plan or ticket labels. The `write-project-overview` skill creates and
> refreshes this file, and `node scripts/overview-check.mjs` finds the lines that no longer match the project.

**What it is**
<One or two sentences: what the product does, for whom, and where it runs. Say what does NOT exist yet
(for example "no backend").>

**Stack**
- <language and version> · <framework and version> · <package manager> (<lock file> is committed)
- State and data: <how state is kept; where data is stored>
- Tests: <runner, where tests live, what they cover, what they do not>
- <other key libraries>

**Implemented** (optional: delete it when the project is only a skeleton)
- <Each feature or screen that works today, one line each, with the folder that holds it.>

**Commands**
```
<install>       # install dependencies
<run>           # start the project
<lint>          # lint
<typecheck>     # type check (if any)
<test>          # tests
<build>         # build
```
Run lint, type check and tests before declaring any task done.

**Architecture** (folder → responsibility)
- `<folder>/`: <what lives here and what must not>
- `<folder>/`: <...>
Rules for where a new file goes are in the repo-tidiness rule. When you add or move a folder, update this
list in the same change.

**Where a new file goes** (one home per kind; never a loose file)
- Component or screen: `<folder>/`. Business rule or service: `<folder>/`. Hook or helper: `<folder>/`.
- Test: beside what it tests (`<name>.test.<ext>`). Script: `<folder>/`. Documentation: `<folder or file>`.

**Root config** (optional: one line per config file that is not obvious)
- `<file>`: <what it controls>

**Conventions**
- <Naming, error handling, text/translation, styling or token rules specific to this project.>
- Readable, self-documenting code, repo tidiness, docs-fresh, commit gate, verification and test discipline
  rules apply (see the rules in the project instructions).

**Known quirks** (documented, not yet fixed)
- <Thing that surprises people, and why it is that way.>

**Repo, git and CI**
- Default branch: `<main|master>`. Branches: `<pattern>`. Pull requests go to `<main|master>`.
- Hooks: <what runs on commit and on push>. CI: <what runs on pull requests and on the default branch>.
- Workflow profile (`.claude/workflow.json`): `<solo|team|org>`. `node scripts/workflow-config.mjs` prints
  what is on.

**Release** (optional: only when the project ships builds)
- <How a release is made, which files carry the version, where it is published.>

**Changelog (every commit)**
Every commit that changes behaviour or UI needs a changelog entry (see `changelog-bump`). In a terminal the
hook asks for the bump type and a one-line description. For a non-terminal commit set
`CHANGELOG_BUMP=patch|minor|major` and `CHANGELOG_ENTRY="Add ..."`. Do not edit the version by hand.
