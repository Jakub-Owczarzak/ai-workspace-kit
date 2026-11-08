# <PROJECT NAME>: overview for assistants and people

> Snapshot of the project: read before exploring code. Last updated: <YYYY-MM-DD> (<what changed>). Update
> it first when a feature or state changes.

**What it is**
<One or two sentences: what the product does, for whom, and where it runs. Say what does NOT exist yet
(for example "no backend").>

**Stack**
- <language and version> · <framework and version> · <package manager> (<lock file> is committed)
- State and data: <how state is kept; where data is stored>
- Tests: <runner, where tests live, what they cover, what they do not>
- <other key libraries>

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

**Conventions**
- <Naming, error handling, text/translation, styling or token rules specific to this project.>
- Readable, self-documenting code, repo tidiness, docs-fresh, commit gate and verification rules apply
  (see the rules in the project instructions).

**Known quirks** (documented, not yet fixed)
- <Thing that surprises people, and why it is that way.>

**Repo, git and CI**
- Default branch: `<main|master>`. Branches: `<pattern>`. Pull requests go to `<main|master>`.
- Hooks: <what runs on commit and on push>. CI: <what runs on pull requests and on the default branch>.

**Changelog (every commit)**
Every commit that changes behaviour or UI needs a changelog entry (see `changelog-bump`). In a terminal the
hook asks for the bump type and a one-line description. For a non-terminal commit set
`CHANGELOG_BUMP=patch|minor|major` and `CHANGELOG_ENTRY="Add ..."`. Do not edit the version by hand.
