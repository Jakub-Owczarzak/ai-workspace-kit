# Native e2e with Maestro

**Status: NOT VERIFIED on a device.** This guide is written from Maestro's own documentation (read on 2026-11-11 at
docs.maestro.dev). Nothing here was run on an emulator, a simulator or a phone. Say so in every report that uses it.
Gaps the documentation did not settle are listed at the end.

## What you, the user, supply

The kit does not install a platform and the assistant never starts one for you.

| Need | For |
|---|---|
| Java 17 or newer (`java -version`) | the Maestro CLI |
| The Maestro CLI | every native run |
| Android: Android Studio with a virtual device running, or a phone with USB debugging on | Android |
| iOS: a Mac with Xcode and its command line tools (`xcode-select --install`), and a simulator | iOS simulators only (real devices are not described in the documentation) |
| The app installed on that device or simulator, already built | every run; Maestro does not install it |
| For Expo: Expo Go with a running dev server, or a development or EAS build | Expo and React Native |

Install the Maestro CLI (from the documentation):

- macOS: `curl -fsSL "https://get.maestro.mobile.dev" | bash`, or Homebrew: `brew tap mobile-dev-inc/tap`,
  `brew trust --formula mobile-dev-inc/tap/maestro`, `brew install mobile-dev-inc/tap/maestro`
- Linux: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
- Windows: download `maestro.zip` from the Maestro GitHub releases page, extract it to `C:\maestro`, add
  `C:\maestro\bin` to `PATH`, restart the terminal. The documentation prefers macOS or Linux over WSL2.

Check with `maestro --version`.

## What the assistant does

1. Check there is a target: `maestro list-devices`. If it lists nothing, **stop** and tell the user to start an
   emulator, a simulator or a device (`maestro start-device --platform android` is documented for Android and iOS).
2. Write flows in `e2e/maestro/<feature>.yaml` from the bucket's "Done when".
3. Run them and report the real output.
4. Gather the screenshots and, if `scripts/e2e-shots.mjs` is installed, publish them (see below).

## A flow

```yaml
appId: com.example.myapp
---
- launchApp:
    clearState: true
- tapOn: "Sign in"
- inputText: "ada@example.com"
- assertVisible: "Welcome, Ada"
- takeScreenshot: login-welcome
```

- `takeScreenshot` takes a name **without** an extension and may include a subfolder (`checkout/payment`). A path
  with `..` fails.
- `assertVisible` retries for about 7 seconds before it fails.
- For one flow file for both platforms, write `appId: ${APP_ID}` and run `maestro test -e APP_ID=<id> flow.yaml`.

## Expo and React Native

- **Expo Go:** the app runs inside Expo's container, so `launchApp` with your own `appId` does not work. Use
  `openLink` with the dev-server URL, for example `- openLink: exp://127.0.0.1:19000`. The `appId` for the Expo Go
  app itself was not found in the documentation; look it up on your device before relying on it.
- **Development build, EAS build or release build:** use `launchApp` with the app's bundle id (iOS) or package name
  (Android).

## The commands to connect (put the first one in `AGENTS.md`)

```
maestro test e2e/maestro --test-output-dir e2e-out   # e2e
```

- `maestro test <folder>` runs the flow files in a folder; `--test-output-dir <dir>` sets where screenshots and other
  artifacts go; `--device <id>` and `--platform <android|ios|web>` pick the target; `maestro list-devices` lists them.

## Screenshots into a pull request

The documentation says screenshots land in the `takeScreenshot` folder of the flow's artifact bundle inside the
output directory. The exact layout was not documented, so after the first run **look**: list `e2e-out` recursively,
find the PNG files, copy them into `e2e-out/shots/`, and publish that folder:

```
node scripts/e2e-shots.mjs publish --dir e2e-out/shots --subdir <branch name>
```

`e2e-shots.mjs` reads only the PNGs directly inside the folder it is given. Once you know the layout for a project,
record it in `AGENTS.md` next to the e2e command.

## Web with Maestro

Maestro can drive Chromium (the documentation calls web support beta, with `url:` in the header instead of `appId:`
and `--headless`). For a web app use the Playwright recipe instead, which is proven here.

## Gaps the documentation did not settle

- The exit codes of `maestro test`: treat any non-zero as a failure and check on your machine.
- Real iOS devices: not stated. Only simulators are described.
- The exact `appId` of Expo Go and of your development build.
- The folder layout of the artifact bundle (see above).
- The full reference for `tapOn`, `inputText` and `launchApp`: only the short forms above were seen. Read
  docs.maestro.dev for the options before writing anything longer.
