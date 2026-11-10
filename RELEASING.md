# Releasing ai-workspace-kit

For the maintainer. A release is a **version tag**: pushing `vX.Y.Z` makes the `publish` workflow run the tests,
the install smoke test and a pack check, and then publish to npm. Nothing else publishes.

## One-time setup

1. **npm account.** Create one at npmjs.com and turn on two-factor authentication.
2. **A token for CI.** npmjs.com > Access Tokens > Generate New Token. The package does not exist yet, so a
   token limited to one package cannot create it: use a **granular token** with *Read and write* on **all
   packages** for the first release, or a classic **Automation** token. Set a short expiry and replace it with a
   token limited to `ai-workspace-kit` once the package exists.
3. **Save it in GitHub.** Repository > Settings > Secrets and variables > Actions > *New repository secret*,
   named `NPM_TOKEN`.
4. **Make the repository public** (Settings > General > Danger Zone > Change visibility). The workflow then adds
   npm provenance (a record of which repository and commit built the package) and macOS CI stops being queued.
   Before you do, check that the history holds nothing private: the author email of commits is public too.
5. **Optional manual gate.** Repository > Settings > Environments > `npm` > *Required reviewers*: add yourself.
   The publish job then waits for your click.

## Releasing

1. Merge your work to `main` and wait for CI. All six jobs must have run and passed (a cancelled macOS job is
   not a pass).
2. Set the version in `package.json` (`npm version minor --no-git-tag-version`, or edit it), commit and merge.
3. Tag the commit on `main` and push the tag:

   ```text
   git checkout main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. Watch **Actions > publish**. It refuses, and publishes nothing, if the tag does not match `package.json`,
   if the tagged commit is not on `main`, or if a test fails.
5. Check the result in a throw-away folder:

   ```text
   npx ai-workspace-kit@latest init --dry-run
   ```

## Rehearsal (publishes nothing)

Actions > publish > *Run workflow*, with *dry run* on (the default). It runs every check and
`npm publish --dry-run`. The workflow file must be on the default branch for this button to appear.

## If a release is wrong

Do not try to take it back. Publish a fixed version, and mark the bad one:
`npm deprecate ai-workspace-kit@0.1.0 "use 0.1.1: <reason>"`. npm restricts unpublishing (and a version number
can never be reused), so deprecating is the normal route.
