# Browser e2e with Playwright

**Status: proven.** Run on Windows 11, Node 22, `@playwright/test` 1.65.0: the package installed in 1.7 s, Chromium
in 36 s the first time (0.4 s when already cached), one test with a screenshot ran in under a second, a passing run
exited 0, and a run with a failing test exited non-zero.

## 1. Install (ask the user first)

Say: "I will add `@playwright/test` as a dev dependency and download Chromium (about 40 s the first time)." Then, in
the project folder:

```
npm install -D @playwright/test
npx playwright install chromium
```

On a CI machine that lacks the system libraries, use `npx playwright install --with-deps chromium`.

## 2. Files

`playwright.config.js` (ES modules; use `module.exports` in a CommonJS project):

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e-out/artifacts',
  reporter: 'list',
  use: { headless: true, viewport: { width: 800, height: 400 } },
});
```

`e2e/home.spec.js`:

```js
import { expect, test } from '@playwright/test';

test('the home page greets by name', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await expect(page.getByRole('heading', { name: 'Hello, Ada!' })).toBeVisible();
  await page.screenshot({ path: 'e2e-out/home.png' });
});
```

`package.json` script: `"e2e": "playwright test"`.

`.gitignore`: add `e2e-out/`.

`AGENTS.md`, in the Commands block: `npm run e2e   # e2e`.

## 3. A project that needs a server

Let Playwright start and stop it, so the test run is one command. In the config:

```js
webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
use: { baseURL: 'http://localhost:3000', headless: true },
```

and use relative paths in tests (`page.goto('/')`). For a static file with no server, `page.goto` a `file://` URL
built with `pathToFileURL`, as in the run that proved this recipe.

## 4. Screenshots

Save them to `e2e-out/` with names that read as alt text (`login-error.png`, `settings-dark.png`). Playwright's own
`outputDir` is a separate subfolder, so `e2e-out/` holds only the screenshots you name and
`node scripts/e2e-shots.mjs publish --dir e2e-out --subdir <branch>` publishes exactly those PNGs.

## 5. Things that go wrong

- **A test that asserts something is absent can pass for the wrong reason.** After a reload, a saved choice is usually
  read asynchronously, so `toHaveCount(0)` or `not.toBeVisible()` right after the page appears can pass before the saved
  value has loaded, and then it could not catch a persistence bug. First wait for a positive sign that the page has
  finished loading (a heading, a control that only renders after the load, `waitForLoadState('networkidle')` for a
  page that fetches), and only then assert the absence. For a persistence test, prove it both ways: after the change
  and reload the state is the saved one, and with nothing saved it is the default.

- A browser is cached per Playwright version. After upgrading the package, run `npx playwright install chromium` again.
- `NO_COLOR` and `FORCE_COLOR` together print a harmless warning.
- Tests that depend on the time, random data or the network are flaky; fix the data or mock the request. Do not
  add retries to hide it.
- Not tried here: Firefox and WebKit, parallel workers beyond one machine, and `--with-deps` on Linux.
