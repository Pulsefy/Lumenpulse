# Mobile app size budget

Install size is a conversion factor for this project's core audience, and
`apps/mobile` grew through Waves 7 and 8 without anyone measuring what that
growth cost. This document defines what gets measured, the thresholds that
enforce it, and how to refresh the numbers.

Tooling: `scripts/check-mobile-size.mjs` (budgets: `mobile-budgets.json`,
recorded baseline: `mobile-baseline.json`).
CI: the `mobile-size` job in `.github/workflows/mobile.yml`.

## What is measured

`expo export` output - the payload that actually ships and updates:

| Metric           | What it is                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `bundle.android` | Hermes bytecode Metro emits for Android (`_expo/static/js/android/*.hbc`).                                   |
| `bundle.ios`     | Hermes bytecode for iOS (`_expo/static/js/ios/*.hbc`).                                                       |
| `bundle.web`     | The web JS bundle (`_expo/static/js/web/*.js`).                                                              |
| `assets`         | Everything in the export that is not a platform bundle: fonts, images, `index.html` and the export metadata. |
| `total`          | The three platform bundles plus `assets`.                                                                    |

Native `.aab` / `.ipa` sizes are **not** measured automatically. Producing one
needs a full native build (JDK + Android SDK, or Xcode + CocoaPods), which is
not available on a standard GitHub runner without the signing setup this
repository does not carry. Record one manually instead - see
[Recording a native binary](#recording-a-native-binary).

### Measured baseline

Recorded in `mobile-baseline.json` from a clean `npm run size:export`:

| Metric           |                         Size |
| ---------------- | ---------------------------: |
| `bundle.android` |   3,927,172 bytes (3.75 MiB) |
| `bundle.ios`     |   3,930,385 bytes (3.75 MiB) |
| `bundle.web`     |   2,186,900 bytes (2.09 MiB) |
| `assets`         |   8,221,716 bytes (7.84 MiB) |
| `total`          | 18,266,173 bytes (17.42 MiB) |

93 files in total. Android and iOS are nearly identical, as expected: they share
the same application code and differ only in platform-specific resolution.

### Run-to-run noise

`expo export` is not bit-for-bit reproducible. Measured on one unchanged tree:
the web bundle is byte-identical between runs, while Hermes `.hbc` output
shifted by 57 bytes (Android) and 17 bytes (iOS) - around 0.0015%. That is why
the budgets are set several percent above the baseline rather than a few bytes
above it; a budget with a few hundred bytes of headroom would flake.

The measurement is also sensitive to a previous export left inside
`apps/mobile`: its files are picked up as assets and inflate the next run by
kilobytes. `dist/` is gitignored for this reason - do not remove that entry.

## Thresholds

`mobile-budgets.json` carries a `warningBytes` and a `maxBytes` per metric.
Exceeding `warningBytes` annotates the pull request and lists the metric as
`WARN`; exceeding `maxBytes` fails the job.

| Metric           |   Baseline | Warning at |   Fails at |
| ---------------- | ---------: | ---------: | ---------: |
| `bundle.android` |  3,927,172 |  4,100,000 |  4,300,000 |
| `bundle.ios`     |  3,930,385 |  4,100,000 |  4,300,000 |
| `bundle.web`     |  2,186,900 |  2,300,000 |  2,450,000 |
| `assets`         |  8,221,716 |  8,600,000 |  9,000,000 |
| `total`          | 18,266,173 | 19,100,000 | 20,000,000 |

The thresholds are intentionally duplicated per metric instead of derived from
one percentage. A metric with a known reason to grow - for example a screen that
adds a large bundled asset - should get explicit headroom without loosening
every other budget.

## How CI reports the delta

The `mobile-size` job runs on every pull request that touches `apps/mobile/**`:

1. Install and export the pull request head.
2. On pull requests, check out `github.event.pull_request.base.sha`, install and
   export it too, so the reported delta is genuinely against the base branch.
3. Run the check and write the report to the job summary, plus annotations for
   any metric past `warningBytes` or `maxBytes`.

If the base branch export is unavailable the job emits a warning and falls back
to the recorded baseline in `mobile-baseline.json`, so a base-branch
infrastructure problem cannot mask the head's own numbers.

On a push to `main` there is no base branch to compare against, so the recorded
baseline is used.

## Refreshing the baseline

Only refresh it deliberately, in a change that explains the new numbers:

```sh
cd apps/mobile
npm run size:baseline     # expo export, then rewrite mobile-baseline.json
```

`npm run size:check` reports the current sizes without touching the baseline.
`npm run size:check -- --baseline-root ../path/to/base/apps/mobile` reproduces
what CI does.

Budgets are not updated automatically. When a change legitimately needs more
room, raise the specific metric's `warningBytes` and `maxBytes` in the same pull
request and say why.

### Recording a native binary

After a signed build:

```sh
cd apps/mobile
npm run size:record-binary -- android=android/app/build/outputs/bundle/release/app-release.aab
npm run size:record-binary -- ios=/path/to/Lumenpulse.ipa
```

That fills the `binary` block in `mobile-baseline.json`, which the report then
prints. Binary numbers are stored rather than measured because they can only
come from a native build.

## Dependency review

Five largest production dependencies of `apps/mobile`, by installed size
(`du -sk node_modules/<pkg>` after `npm ci`) as of the baseline commit:

| #   | Package                          | Installed | Required?            | Why                                                                                                                                                                                                |
| --- | -------------------------------- | --------: | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `react-native` 0.81.5            |  83.42 MB | Required             | The runtime itself; imported directly by 48 files.                                                                                                                                                 |
| 2   | `expo` ~54.0.37                  |  25.24 MB | Required             | SDK and native module host; `expo/metro-config`, `expo-router` and the `expo` CLI all resolve through it. Referenced by 47 files.                                                                  |
| 3   | `react-native-reanimated` ~4.1.1 |   8.86 MB | Required, indirectly | Never imported by application code, but `babel.config.js` registers `react-native-reanimated/plugin`, and `expo-router`'s stack transitions depend on it at runtime. Removing it breaks the build. |
| 4   | `@expo/vector-icons` ^15.0.3     |   6.41 MB | Required             | Every tab bar and list icon; referenced by 28 files.                                                                                                                                               |
| 5   | `react-dom` 19.1.0               |   6.36 MB | Required, indirectly | Never imported directly; it is the peer `react-native-web` needs at runtime, and `app.json` selects that target with `web.bundler: "metro"`. The Playwright E2E suite runs against the web build.  |

Several other packages also have no direct import and are still required for the
same reason - they are platform peers pulled in by configuration rather than by
`import`:

| Package                                               | Required because                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `react-native-web`                                    | The web target selected by `app.json`; aliased in by `babel-preset-expo`, so nothing imports it by name. |
| `react-native-screens`                                | Native screen primitives used by `expo-router`; a peer, satisfied by presence.                           |
| `react-native-safe-area-context`                      | Peer of `react-native-screens` and the navigation stack.                                                 |
| `react-native-worklets`, `react-native-worklets-core` | Peer dependencies of `react-native-reanimated` under the new architecture (`newArchEnabled: true`).      |
| `expo-dev-client`                                     | Dev builds only; not imported by application code but needed for `expo run:*`.                           |
| `lumenpulse` (`file:../..`)                           | The monorepo root; Metro resolves the workspace through it (see the comment in `mobile.yml`).            |

### Removed as unused

`i18next-resources-to-backend` was declared in `dependencies` but imported
nowhere: `src/i18n/index.ts` initialises i18next with `initReactI18next` only,
and the package is a plugin that has to be wired explicitly with
`i18n.use(ResourcesToBackend(...))`. It was removed from `package.json` and
`package-lock.json`.

Because it was never imported it also contributed nothing to the bundle: the
web bundle is byte-identical before and after, and the Hermes bundles moved
inside the run-to-run noise above. The win is a smaller install and audit
surface, not a smaller download - which is exactly the kind of thing this
budget exists to make visible.
