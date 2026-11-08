# Routing rows: Expo / React Native

Paste into the project's `workspace-router`, section 2.2 (project skills). With the Claude Code plugin the
names are `expo:<name>`; with a repo-local copy the path is `.agents/skills/<name>/SKILL.md`. Remove the rows
for skills you do not have. Order matters: read earlier rows first.

## Expo core: build and architecture

| Skill | Use when |
|---|---|
| `expo-overview` | First stop for any Expo task: which library for X, which skill next |
| `expo-project-structure` | Creating or understanding app structure, entry points, `src/app/` layout, config files |
| `expo-router` | Routes, layouts, params, deep links, redirects, stack/group/tab/sheet presets, `+api.ts` |
| `expo-ui` | Choosing native components from `@expo/ui` (first stop for any new component) |
| `expo-native-ui` | Composing native-feeling screens: surfaces, spacing, layout, platform-specific styling |
| `expo-design-system` | Design tokens, theming, light/dark, component tokens; has a native-slop list and an audit |
| `expo-animation` | Reanimated, worklets, gestures, press feedback, haptics |
| `expo-data-fetching` | Network requests, caching, offline, loading/empty/error states, route loaders |
| `expo-dom` | Web code in a webview on native, web-only paths, hybrid web/native |
| `expo-module` | Writing native (iOS/Android) modules and views with the Expo Modules API |
| `expo-brownfield` | Adding Expo/RN screens into an existing native app |
| `expo-dev-client` | Custom dev builds when Expo Go is not enough |
| `expo-app-clip` | iOS App Clips |
| `expo-examples` | Working reference apps for a third-party integration |
| `expo-upgrade` | Expo SDK and dependency upgrades |
| `expo-web-to-native` | Porting an existing web app to native |

## EAS: ship and operate

| Skill | Use when |
|---|---|
| `eas-app-stores` | `eas build` / `submit`, TestFlight, App Store, Play, `eas.json`, signing, build numbers |
| `eas-hosting` | Deploying Expo web and API routes, `eas deploy`, env secrets, domains |
| `eas-update` | OTA updates: channels, `eas update`, rollback, runtime versions |
| `eas-update-insights` | Health and adoption of published updates |
| `eas-observe` | `expo-observe`, route metrics, crash reporting, `eas observe:*` |
| `eas-simulator` | Cloud simulators, headless CI, agent-driven screenshots |
| `eas-workflows` | EAS Workflows CI/CD YAML |

## Live documentation

| Source | Use when |
|---|---|
| `react-docs` (if installed) or `https://docs.expo.dev/versions/v<major>.0.0/` | React, React Native, TypeScript or Expo APIs; the Expo docs have a lighter `.md` form and an index at `https://docs.expo.dev/llms.txt` |
