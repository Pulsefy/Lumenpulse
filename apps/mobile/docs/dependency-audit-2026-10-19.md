# Mobile dependency audit — 2026-10-19

Issue: [#1584](https://github.com/Pulsefy/Lumenpulse/issues/1584).
Baseline: `7a19553fc4f5ebf1d4658000e1514416432f8c34`.
The original before/after measurements compare that baseline with `55cb9bb`.
The 2026-10-21 integration section below records validation after syncing newer
upstream features; those original measurements are not a current-base comparison.
Measurements use Windows x64, Node 24.14.0 and npm 11.9.0, with the same
environment for both revisions. CI continues to use the root `.nvmrc`.

## Changes and dependency decisions

- Remove **Axios**. Its only mobile import was the settings connection probe;
  the rest of the app already uses the platform Fetch API. The replacement
  preserves GET, treats every HTTP status as reachable, aborts after five seconds
  and clears its timer on both success and failure. Five regression cases cover
  HTTP 200/404/500, a network failure and a stalled request.
- Remove **react-native-worklets-core**. No source, config plugin, native
  integration or other dependency consumes it. Reanimated 4.1.6 requires
  `react-native-worklets >=0.5.0`, which remains installed; it does not require
  the separate `worklets-core` package.
- Remove **lumenpulse: file:../..**. No application import uses this private
  root manifest, which exposes no mobile library. The pnpm workspace still
  determines Metro's monorepo root, so root tooling is still installed.
- Pin all **29 runtime and 12 development dependencies** to exact versions
  (26 runtime dependencies before the 2026-10-21 upstream integration).
  Preserve the resolved Expo 54 / React Native 0.81 versions. Align the direct
  Babel preset to Expo's existing `54.0.12`, removing its duplicate `54.0.10` copy.
- Refresh compatible transitive dependencies. Add narrow overrides for
  `brace-expansion@1 -> 1.1.21` and Expo Metro's `postcss -> 8.5.29`.
  Both keep their existing major versions; PostCSS's `~8.4` constraint otherwise
  prevents npm audit from selecting its patched 8.5 release.
- Keep npm's mobile lockfile and synchronize the workspace pnpm lockfile using
  pnpm 10.34.7. Remove the obsolete nested pnpm lockfile, which still described
  Expo 54.0.31, removed barcode/webpack dependencies and an earlier manifest.
  Regeneration also records `scripts`' already-declared `binaryen 132.0.0`.

The review inspected TypeScript imports, `require` and dynamic imports, Expo
plugins, Babel/Metro/Jest configuration, package peer requirements and the
resolved `npm ls --all` tree. Both the baseline and changed npm trees report
no dependency problems. Zero direct imports alone are not proof of redundancy:
the configured animation toolchain, native routing peers, web renderer and
development client remain necessary integrations. Image caching uses `expo-image`,
crash reporting uses the existing app code, and the chart uses React Native
primitives; there is no additional unused crash/chart SDK to remove. AsyncStorage
and SecureStore serve different data sensitivity requirements and both remain.

## Vulnerabilities

Source: `npm audit --package-lock-only --registry=https://registry.npmjs.org --json`
on both lockfiles, 2026-10-19. The explicitly selected registry matters because
some npm mirrors do not implement the audit endpoint. The complete changed-tree
response is attached as [audit-after-2026-10-19.json](audit-after-2026-10-19.json).

| npm severity                   | Before | After |
| ------------------------------ | -----: | ----: |
| Critical                       |      2 |     0 |
| High                           |     52 |    42 |
| Moderate                       |     22 |    20 |
| Low                            |      1 |     0 |
| Total affected package records |     77 |    62 |

These are npm's affected-package counts, including propagation to parent
packages, **not 62 independent vulnerabilities**. Remaining findings originate
in the six packages below. No claim of a vulnerability-free tree is made.

Resolved findings include the removed Axios/follow-redirects/form-data chain,
Handlebars `4.7.9 -> 4.7.10`, shell-quote `1.8.3 -> 1.12.0`, Babel core
`7.29.0 -> 7.29.7`, humanfs `0.16.7 -> 0.16.8`, baseline-browser-mapping
`2.10.9 -> 2.11.29`, browserslist `4.28.1 -> 4.29.3`, vulnerable brace-expansion
copies, js-yaml `3.14.2/4.1.1 -> 3.15.2/4.3.2`, nanoid `3.3.11 -> 3.3.20`,
picomatch `2.3.1 -> 2.3.2`, PostCSS `8.4.49 -> 8.5.29`, source-map-js
`1.2.1 -> 1.2.2`, ws `6.2.3/7.5.10 -> 6.2.6/7.5.13`, and yaml `2.8.2 -> 2.9.1`.

### Remaining findings and rationale for retaining them

These are explicit compatibility exceptions for maintainer review, not suppressed
audit output. Revisit them when the named upstream constraint changes, and before
upgrading the Expo SDK or changing how untrusted data reaches these packages.

| Package / advisory                                                                                                                                                      | Exposure and reason for retaining it                                                                                                                                                                                                                                                                                                                                                       | Revisit condition                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `braces 3.0.3` — [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)                                                                               | Build/test glob processing through micromatch, Metro and Jest. Deeply nested attacker-supplied patterns can exhaust the stack. The advisory and registry have no patched release. App code does not accept arbitrary glob patterns; repository/tool configuration is the relevant input.                                                                                                   | A patched braces release or a compatible upstream replacement; review untrusted build inputs in the meantime. |
| `decode-uri-component 0.2.2` — [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)                                                                 | **Runtime risk:** Expo Router / React Navigation's query-string path can receive untrusted URLs, so malformed input may stall navigation. The fix is `0.5.0`, an ESM-only export; query-string 7 currently uses a callable CommonJS `require`. A blind override changes that contract. Retained pending a coordinated router/query-string upgrade rather than claiming this is build-only. | A compatible decoder backport or a router upgrade with malformed-link and native-navigation coverage.         |
| `image-size 1.2.1` — [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | Metro examines repository image assets at build time. Crafted JXL/HEIF/ICNS content can hang the parser. Patched 2.x changes the callable default export used by Metro's `Assets.js`, so forcing it over Metro's `^1.0.2` is unsafe. Keep reviewed assets in builds.                                                                                                                       | Metro/Expo adopts the patched image-size API, or a 1.x fix becomes available.                                 |
| `node-forge 1.4.0` — [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)                                                                           | Expo CLI/code-signing tooling uses this package; it is not a wallet-signature implementation. RSA signature verification is affected and no patched release was available. Do not treat this exception as approval to trust unreviewed signing material.                                                                                                                                   | Upstream patch and a compatible Expo tooling update.                                                          |
| `sprintf-js 1.0.3` — [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)                                                                           | Coverage/config CLI formatting via argparse; unbounded precision in attacker-controlled format strings can exhaust resources. No patched release was available. The app does not expose this formatter to runtime input.                                                                                                                                                                   | Patched formatter or coverage-tooling dependency update.                                                      |
| `uuid 7.0.3` — [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)                                                                                 | Xcode project generation uses `uuid.v4()` without a caller buffer. The finding concerns v3/v5/v6 with a provided buffer; that path is not used by the inspected consumer. The fix requires 11.1.1+, outside xcode's `^7.0.3` range.                                                                                                                                                        | Compatible xcode update or any change to the UUID call site.                                                  |

The npm audit suggestions to downgrade Expo to 44 or jump React Native/Jest/router
major versions were not applied. Those suggestions do not establish compatibility
with this Expo 54 app. npm audit still exits nonzero for the documented exceptions.
The counts and snapshot above describe the **npm mobile tree**, not the backend,
webapp, or all dependencies in the root pnpm workspace.

## Measured size delta

Both revisions were installed with `npm ci --no-audit --no-fund`. Install size is
the logical byte sum of regular files inside **mobile `node_modules`**, including
development dependencies, excluding symlink targets, npm cache and root tooling.
It is not device storage use. `scripts/measure-dependency-install.mjs` makes the
same measurement for either app directory.

| Metric                    | Before (bytes) | After (bytes) |     Delta (bytes) |
| ------------------------- | -------------: | ------------: | ----------------: |
| Dependency install        |    353,118,194 |   352,317,864 | -800,330 (-0.23%) |
| Android Hermes bundle     |      4,169,293 |     4,107,280 |  -62,013 (-1.49%) |
| iOS Hermes bundle         |      4,172,165 |     4,110,125 |  -62,040 (-1.49%) |
| Web JS bundle             |      2,336,911 |     2,296,732 |  -40,179 (-1.72%) |
| Shared export assets      |      8,221,806 |     8,221,806 |                 0 |
| All-platform export total |     18,900,175 |    18,735,943 | -164,232 (-0.87%) |

Production exports used `npm run size:export -- --max-workers 2` on both trees.
All hard size budgets pass. Android/iOS remain above their pre-existing warning
thresholds, but both shrink; budgets and historical baselines are unchanged.
Hermes output can vary by a few bytes across identical runs.

This is the repository's existing exported-app-payload measurement, **not an
APK/AAB/IPA measurement**. No native binary or device-installed-size delta is
claimed: a usable Android SDK and Xcode/signing setup were unavailable here.
Native binary accounting remains a release-build follow-up using the existing
`size:record-binary` workflow.

## Original validation and reproduction (2026-10-19)

- Clean `npm ci` succeeds; `npm ls --all` reports no dependency problems.
- All 38 remaining direct version specifiers are exact and match the root pnpm importer.
- Type check passes. Unit suite: **40 suites, 487 tests**, including five new
  connection-probe cases; baseline: 39 suites, 482 tests.
- Existing Chromium E2E suite: **7/7 pass**, including launch, login, navigation,
  project detail, contribution modal and startup measurement.
- ESLint passes for the changed source/test/measurement files. Full source lint
  remains non-green on both revisions: baseline **256 errors / 42 warnings**,
  changed **251 errors / 41 warnings**, using the same `endOfLine: auto` CLI
  override to exclude Windows checkout line-ending noise. No global autofix was run.
- Android/iOS/web exports succeed and the existing size checker passes hard budgets.

From two checkouts (one at the baseline commit, one at this PR), install root
tooling with `npm install --no-audit --no-fund`, then run in each `apps/mobile`:

```sh
npm ci --no-audit --no-fund
npm ls --all --json > dependency-tree.json
npm audit --package-lock-only --registry=https://registry.npmjs.org --json > audit.json
npm run tsc -- --noEmit
npm run test:coverage
npm run size:export -- --max-workers 2
```

From this PR's `apps/mobile`, compare the baseline directory:

```sh
node scripts/measure-dependency-install.mjs
node scripts/measure-dependency-install.mjs /path/to/base/apps/mobile
node scripts/check-mobile-size.mjs --baseline-root /path/to/base/apps/mobile
npm exec -- playwright install chromium
npm run e2e
```

Audit JSON exits nonzero while the exceptions above remain. Keep measurement
outputs outside `dist`; compare fresh exports made with the same toolchain.

## Main-branch integration — 2026-10-21

Synced upstream `a1bad760`, including its background refresh implementation.
Keep `expo-background-task 1.0.10`, `expo-battery 10.0.8` and
`expo-task-manager 14.0.9`: all three are imported by
`lib/background-refresh.ts`, and the background-task plugin is configured in
`app.json`. These are required upstream dependencies, not candidates for removal.
Both lockfiles retain the dependency removals and compatible security updates
described above. The workspace lockfile was synchronized with pnpm 10.26.1,
matching the package manager version now declared by upstream.

- Clean `npm ci` and `npm ls --all` pass without dependency problems.
- All **41** direct dependencies have exact versions matching the npm lockfile
  and the root pnpm importer; pnpm's frozen-lockfile validation passes.
- Type checking and the **46 suites / 560 tests** with coverage pass, including
  the upstream background-refresh, theme and moderation tests.
- ESLint passes for the source, regression test and measurement script changed
  by this PR; the full source-lint limitation recorded above remains separate.
- A fresh registry audit still reports **0 critical, 42 high and 20 moderate**
  affected-package records. The existing compatibility exceptions still apply;
  the current response is attached as
  [audit-after-2026-10-21.json](audit-after-2026-10-21.json).

The size table above remains the original same-toolchain comparison. Upstream
features add code and dependencies, so it must not be treated as a measurement
against the newly synchronized base. The Mobile CI size job exports both the PR
and its current base and publishes that comparison in its run summary/artifact.

## Direct dependency inventory

Versions below are the pinned versions in this PR. References exclude generated
coverage/export files; configuration and peer integrations are reviewed separately.

| Dependency                                  | Pinned version | Source/configuration evidence                                               |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| `@expo/vector-icons`                        | 15.1.1         | `app/(tabs)/_layout.tsx`, `app/(tabs)/discover.tsx`                         |
| `@react-native-async-storage/async-storage` | 2.2.0          | `contexts/EnvironmentContext.tsx`, `contexts/ThemeContext.tsx`              |
| `@react-native-community/netinfo`           | 11.4.1         | `contexts/WatchlistContext.tsx`, `lib/__tests__/api-client.mocks.test.ts`   |
| `expo`                                      | 54.0.37        | `metro.config.js`                                                           |
| `expo-background-task`                      | 1.0.10         | `lib/background-refresh.ts`, `app.json` plugin                              |
| `expo-battery`                              | 10.0.8         | `lib/background-refresh.ts`                                                |
| `expo-camera`                               | 17.0.10        | `app/settings/manage-accounts.tsx`                                          |
| `expo-constants`                            | 18.0.14        | `lib/config.ts`                                                             |
| `expo-dev-client`                           | 6.0.21         | Native development client, including biometrics outside Expo Go             |
| `expo-device`                               | 8.0.10         | `contexts/NotificationsContext.tsx`, `lib/push-token.ts`                    |
| `expo-image`                                | 3.0.11         | `app/(tabs)/projects/[id].tsx`, `components/CachedImage.tsx`                |
| `expo-linking`                              | 8.0.12         | `contexts/DeepLinkContext.tsx`, `contexts/WalletContext.tsx`                |
| `expo-local-authentication`                 | 17.0.9         | `lib/__tests__/coverage-floor.test.ts`, `lib/__tests__/stepup-auth.test.ts` |
| `expo-localization`                         | 17.0.9         | `src/i18n/index.ts`                                                         |
| `expo-notifications`                        | 0.32.17        | `contexts/NotificationsContext.tsx`                                         |
| `expo-router`                               | 6.0.24         | `app/(tabs)/_layout.tsx`, `app/(tabs)/discover.tsx`                         |
| `expo-secure-store`                         | 15.0.8         | `lib/__tests__/coverage-floor.test.ts`, `lib/__tests__/storage.test.ts`     |
| `expo-status-bar`                           | 3.0.9          | `app/(tabs)/index.tsx`                                                      |
| `expo-task-manager`                         | 14.0.9         | `lib/background-refresh.ts`                                                |
| `i18next`                                   | 25.10.10       | `src/i18n/index.ts`                                                         |
| `react`                                     | 19.1.0         | `app/(tabs)/discover.tsx`, `app/(tabs)/grants/[id].tsx`                     |
| `react-dom`                                 | 19.1.0         | Web renderer required by react-native-web                                   |
| `react-i18next`                             | 16.6.6         | `src/i18n/index.ts`                                                         |
| `react-native`                              | 0.81.5         | `app/(tabs)/discover.tsx`, `app/(tabs)/grants/[id].tsx`                     |
| `react-native-reanimated`                   | 4.1.6          | babel.config.js plugin and configured navigation animation integration      |
| `react-native-safe-area-context`            | 5.6.2          | `components/NetworkBadge.tsx`                                               |
| `react-native-screens`                      | 4.16.0         | Expo Router native navigation peer                                          |
| `react-native-web`                          | 0.21.2         | app.json web target and Chromium E2E                                        |
| `react-native-worklets`                     | 0.5.1          | Reanimated native peer (>=0.5.0)                                            |
| `@playwright/test`                          | 1.63.0         | `e2e/contribution-modal.spec.ts`, `e2e/launch.spec.ts`                      |
| `@types/jest`                               | 29.5.14        | TypeScript declarations for Jest tests                                      |
| `@types/react`                              | 19.1.17        | TypeScript declarations for React components                                |
| `babel-preset-expo`                         | 54.0.12        | babel.config.js preset; aligned with Expo                                   |
| `eslint`                                    | 9.39.4         | lint script CLI                                                             |
| `eslint-config-expo`                        | 10.0.0         | `eslint.config.mjs`                                                         |
| `eslint-config-prettier`                    | 10.1.8         | `eslint.config.mjs`                                                         |
| `eslint-plugin-prettier`                    | 5.5.5          | `eslint.config.mjs`                                                         |
| `jest`                                      | 29.7.0         | test and coverage script CLI                                                |
| `prettier`                                  | 3.8.1          | format script and ESLint integration                                        |
| `ts-jest`                                   | 29.4.12        | jest.config.js preset/transform                                             |
| `typescript`                                | 5.9.3          | tsc script and ts-jest compiler                                             |
