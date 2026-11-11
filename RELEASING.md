# Releasing ai-workspace-kit

For the maintainer. How a release works:

- **The first release (0.1.0) is published by hand**, once, from your own machine.
- **Every later release is a version tag.** Pushing `vX.Y.Z` makes the `publish` workflow run the tests, the install
  smoke test and a pack check, and then publish to npm through **trusted publishing**: npm trusts this repository's
  workflow directly, so **no token or password is stored in GitHub**. Nothing else publishes.

Why no token: npm removed classic tokens in November 2025, and its documentation says that publishing a new version
directly with a granular token "will be removed in January 2027". Trusted publishing is the supported way.
([About access tokens](https://docs.npmjs.com/about-access-tokens/),
[Trusted publishing](https://docs.npmjs.com/trusted-publishers/))

## One-time setup

1. **An npm account** (npmjs.com) with two-factor authentication on, at the level **"Authorization and
   publishing"** (Account > Two-Factor Authentication). Without it `npm publish` fails with
   `403 ... Two-factor authentication ... is required to publish packages`. Do not create an access token.
2. **The repository is public**, which also lets npm record provenance (which repository and commit built a version).
3. **Optional manual gate.** Repository > Settings > Environments > `npm` > *Required reviewers*: add yourself. The
   publish job then waits for your click.

## The first release, by hand (v0.1.0)

From a clone of this repository, with `main` up to date and CI green (all six jobs must have run and passed; a
cancelled macOS job is not a pass):

```text
git switch main
git pull
npm login
npm whoami
npm publish
```

- `npm login` opens a browser or asks for your 2FA code. `npm publish` runs the tests first (`prepublishOnly`), and
  the package is already marked public.
- **The version may be staged, not live.** On 2026-11-10 the upload printed `+ ai-workspace-kit@0.1.0`, yet npm had
  only created a placeholder version `0.0.0-stage`, and `0.1.0` stayed hidden until it was approved: npmjs.com >
  **Staged Packages** > the version > **Approve**, confirmed with 2FA (the CLI route, `npm stage approve`, needs
  npm 11.15 or newer). It went live within about a minute. The `+ name@version` line is therefore **not** proof of
  a release: check with `npm view ai-workspace-kit versions --json`. The `0.0.0-stage` placeholder stays in the
  version list; `latest` points at the real version.
- If npm refuses (a name or version problem), stop and look at the message before trying anything else. A version
  number that was ever published can never be used again, even after an unpublish.
- Check it from a throw-away folder: `npx ai-workspace-kit@latest init --dry-run`.
- Record the release in git. Pushing the tag runs the workflow, which sees that this version is already on npm and
  publishes nothing (it still runs the tests):

  ```text
  git tag v0.1.0
  git push origin v0.1.0
  ```

## Set up trusted publishing (once the package exists on npm)

Do this right before the first release made through the workflow: npm says a new trusted publisher configuration
"must complete its first successful publish within 2 days" or it expires.

On npmjs.com: the package > *Settings* > *Trusted Publisher* > GitHub Actions, and enter exactly (case-sensitive):

| Field | Value |
|---|---|
| Organization or user | `Jakub-Owczarzak` |
| Repository | `ai-workspace-kit` |
| Workflow filename | `publish.yml` (only the file name, not the path) |
| Environment name | leave empty |
| Allowed actions | direct `npm publish` must be allowed |

npm does **not** check these values when you save them; a typo only shows up when a publish fails. The workflow
needs `id-token: write` (it has it), npm 11.5.1 or later (it installs one) and the `repository.url` in
`package.json` must match the GitHub repository exactly (it does).

## Later releases

1. Merge your work to `main` and wait for CI (all six jobs ran and passed).
2. Set the new version in `package.json` (`npm version patch --no-git-tag-version`, or edit it), open a pull request
   and merge it.
3. Tag the commit on `main` and push the tag:

   ```text
   git switch main
   git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Watch **Actions > publish**. It refuses, and publishes nothing, if the tag does not match `package.json`, if the
   tagged commit is not on `main`, or if a test fails. If the version is already on npm it skips the publish.
5. Check the result in a throw-away folder: `npx ai-workspace-kit@latest init --dry-run`.

**What happened the first time.** The run for `v0.1.1` was green, but its publish step was **skipped** ("Is this version
already on npm?": 0.1.1 had been published by hand first), so it proved nothing. `v0.2.0` (2026-11-11) was the first run to
reach `npm publish`. It failed the first time with `npm error 404 Not Found - PUT https://registry.npmjs.org/ai-workspace-kit`
after signing the provenance statement: npm had no Trusted Publisher for the package yet. The fix was on npmjs.com: the
package > *Settings* > *Trusted Publisher* > GitHub Actions, with the fields in the table above, the *Environment name*
`npm` (the publish job runs in an environment of that name, so a value here must be `npm`) and **Allow `npm publish`**
ticked (the workflow publishes directly; without it npm refuses). Then **Actions > publish** > the failed run > *Re-run
failed jobs*. It published, and the new version showed as **Validating** on npmjs.com (npm's automated review) for a few
minutes before it went live with a provenance attestation. The trusted publisher stays *Pending validation* until the
first publish succeeds, and expires if that does not happen within 2 days.

A green run is not proof of a publish: look for the `+ ai-workspace-kit@<version>` line, then wait for the version to
leave *Validating* and check `npm view ai-workspace-kit versions --json`.

## Rehearsal (publishes nothing)

Actions > publish > *Run workflow*, with *dry run* on (the default). It runs every check and `npm publish --dry-run`.

## If a release is wrong

Do not try to take it back. Publish a fixed version, and mark the bad one:
`npm deprecate ai-workspace-kit@0.1.0 "use 0.1.1: <reason>"`. npm restricts unpublishing (and a version number can
never be reused), so deprecating is the normal route.
