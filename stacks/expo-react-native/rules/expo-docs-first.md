## Expo: skill and docs first

Expo ships breaking changes every SDK. An API you remember may be renamed, moved or removed.

- **Before Expo, EAS or React Native API work, load the matching Expo skill** (for example `expo-router`,
  `expo-ui`, `eas-update`; the plugin names them `expo:<name>`). Load each once per session, the first
  time its area comes up. If no skill covers it, read the docs for the project's SDK:
  `https://docs.expo.dev/versions/v<major>.0.0/` (the major version is `expo` in `package.json`).
- **Add packages with `npx expo install <package>`**, never `npm install`, so the version matches the SDK.
- **Do not edit `ios/` or `android/`.** They are generated; change `app.json` and config plugins. A
  library with native code that Expo Go does not bundle needs a development build.
- **Routes live in `src/app/`**, and every file there is a screen. Keep components, hooks and utilities
  outside it. `Tabs` from `expo-router` is deprecated; check the router skill for the current import.
- **A typed-routes list (`.expo/types/`) is rewritten by the dev server, not by `expo export`.** After adding
  a route, start the dev server once so the type check knows the path.
- **Say which platform you verified.** Web, Expo Go on a phone, and a native build behave differently
  (for example `expo-sqlite` needs a separate path on the web). Report what was run and what was not.
