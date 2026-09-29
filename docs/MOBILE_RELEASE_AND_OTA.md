# Mobile Release and OTA Process

How a Lumenpulse mobile release is cut, how an over-the-air (OTA) update is published, how
either is rolled back, and what gates a release. This is the operational counterpart to
[mobile-contributing.md](mobile-contributing.md), which covers day-to-day development.

Scope is `apps/mobile` (Expo SDK 54, `expo-router`, React Native 0.81). For the stack-wide
release gate that this feeds into, see
[TESTNET_OPERATIONS_RUNBOOK.md §2](TESTNET_OPERATIONS_RUNBOOK.md#2-release-readiness-gate).

---

## 0. Prerequisites not yet in the repository

Read this section before following any other. Parts of the pipeline below describe the
intended process but cannot be executed today, because the configuration they depend on is not
committed. Anyone cutting the first release must land these first, in one PR, and then delete
this section.

| Missing | Where it belongs | Why it blocks |
|---|---|---|
| `eas.json` with `development`, `preview`, `production` profiles | `apps/mobile/eas.json` | Every `eas build` / `eas update` command below resolves its profile and channel from this file. |
| `expo-updates` dependency | `apps/mobile/package.json` | OTA is not possible without it. It is absent today, so **no build currently in the field can receive an OTA update**. |
| `updates` and `runtimeVersion` keys | `apps/mobile/app.json` | `runtimeVersion` is what keeps an OTA payload from being delivered to a binary with incompatible native code. Without it, OTA is unsafe. |
| `extra.eas.projectId` and `owner` | `apps/mobile/app.json` | Required to target builds and updates at an EAS project. |
| A `projectId` argument to `getExpoPushTokenAsync()` | [contexts/NotificationsContext.tsx:76](../apps/mobile/contexts/NotificationsContext.tsx#L76) | The call takes no argument today. That resolves in Expo Go but throws in a standalone EAS build, so push registration would fail for every real release user. |
| `ios.buildNumber` / `android.versionCode`, or EAS `autoIncrement` | `apps/mobile/app.json` or `eas.json` | Stores reject a second upload with a build number already used. |

Until these exist, only §1, §2, §5, §6 and the store-release half of §4 are actionable;
everything OTA-specific is the target state.

---

## 1. Release channels

Three channels, matching the three build profiles and mapping onto the app's own
testnet/mainnet environment switch ([lib/config.ts](../apps/mobile/lib/config.ts)).

| Channel | Build profile | Distribution | `EXPO_PUBLIC_APP_VARIANT` | Default network | Who gets it |
|---|---|---|---|---|---|
| `development` | `development` | `expo-dev-client`, local | `development` | Testnet | Contributors on a workstation |
| `preview` | `preview` | Internal — TestFlight / Play internal testing | `preview` | Testnet | Maintainers, QA, release verification |
| `production` | `production` | App Store / Google Play | `production` | Testnet; mainnet available when configured | Public |

Two rules follow from `validateEnvironmentConfig()` in
[lib/config.ts](../apps/mobile/lib/config.ts):

- A `production` build **throws at startup** if `EXPO_PUBLIC_MAINNET_API_URL` or
  `EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL` is unset or points at localhost, or if the testnet API
  URL is still the `http://localhost:3000` default. A missing secret is therefore a launch-time
  crash for every user, not a degraded mode. Verify §6 before building.
- The app still opens on testnet regardless of channel. Mainnet is opt-in via Settings and is
  offered only when `isMainnetConfigured` is true. Shipping a production build does not move
  users onto mainnet.

---

## 2. Versioning

Three numbers, changed for different reasons. Keep them in `apps/mobile/app.json` and
`apps/mobile/package.json` (both currently `1.0.0`).

| Field | Meaning | When it changes |
|---|---|---|
| `expo.version` | User-facing semver, shown on the in-app status screen | Every store release |
| `ios.buildNumber` / `android.versionCode` | Store upload identity | Every binary uploaded, including a rebuild of the same version |
| `expo.runtimeVersion` | Native compatibility identity | Whenever native code changes — see §3 |

`runtimeVersion` is the safety mechanism for OTA: an update is delivered only to a binary whose
runtime version matches. Use the `appVersion` policy so it tracks `expo.version`:

```json
"runtimeVersion": { "policy": "appVersion" }
```

With that policy a version bump automatically ends OTA eligibility for older binaries — which
is what you want, since a version bump usually accompanies a native change.

### Release notes

Every release adds an entry to
[assets/release-metadata.json](../apps/mobile/assets/release-metadata.json), newest first. The
in-app **Settings › Status** screen renders this file
([app/settings/status.tsx](../apps/mobile/app/settings/status.tsx)), and
[lib/error-reporting.ts](../apps/mobile/lib/error-reporting.ts) stamps the version onto every
crash report. An entry looks like:

```json
{
  "version": "1.1.0",
  "date": "2026-10-14",
  "title": "Saved watchlists and offline drafts",
  "notes": ["One user-visible change per line."]
}
```

If that file is missing or malformed the app falls back to `fallbackReleaseMetadata` in
[lib/release-metadata.ts](../apps/mobile/lib/release-metadata.ts), which is pinned at 1.0.0.
The failure is silent — nothing crashes and no test fails — so a status screen reporting 1.0.0
after a later release is the only signal that the asset failed to parse. Check it on every
release.

---

## 3. OTA versus store build

An OTA update ships **only the JavaScript bundle and the assets Metro bundles**. It cannot
change native code, entitlements, permissions, or anything the stores review. Getting this
wrong ships a bundle that crashes on launch against the old binary.

### Eligible for OTA

- JS/TS changes under `app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `src/`, `theme/`
- Copy and i18n catalog changes under `locales/`
- Styling and layout changes
- Bundled asset changes: images under `assets/`, and `assets/release-metadata.json`
- `EXPO_PUBLIC_*` values, which are inlined into the bundle at build time — an OTA rebundles,
  so a changed value does ship (see §6 for why this is a hazard)
- Bug fixes in API calls, caching, or error handling

### Requires a store build

- Any change to `app.json`: `plugins`, permissions, `infoPlist`, `scheme`, icons, splash
- Adding, removing, or upgrading a dependency with native code — every `expo-*` module here
  (`expo-local-authentication`, `expo-notifications`, `expo-secure-store`,
  `expo-barcode-scanner`, `expo-device`), plus `react-native-reanimated`,
  `react-native-screens`, `react-native-worklets`
- An Expo SDK or React Native upgrade
- A `runtimeVersion` change — by definition
- Anything altering store metadata, privacy disclosures, or requested permissions

**The rule:** if `npx expo prebuild` would produce different native output, or if the change
touches `app.json` or a dependency, it needs a store build. When in doubt, ship a store build —
an unnecessary store submission costs days; a bad OTA costs a crash loop in the field.

---

## 4. Cutting a release, end to end

### 4.1 Store release

1. **Confirm the gates in §5 pass on the commit you intend to ship** — not on an earlier commit,
   and not on a branch that has since moved.
2. **Branch.** `git checkout -b release/mobile-v<version>` from an up-to-date `main`.
3. **Bump the version.** Set `expo.version` in `apps/mobile/app.json` and `version` in
   `apps/mobile/package.json` to the same value. If not using EAS `autoIncrement`, bump
   `ios.buildNumber` and `android.versionCode` too.
4. **Add the release notes entry** to `assets/release-metadata.json` (§2), then run
   `npm test -- release-metadata`. Note what that test does *not* prove: because
   `getReleaseMetadata()` catches a parse failure and returns the fallback, a malformed asset
   still passes. Confirm the new entry by eye on the Settings › Status screen at step 7.
5. **Open the release PR**, titled `chore(mobile): release v<version>`. Follow the
   [Definition of Done for Issue Closure](../CONTRIBUTING.md#definition-of-done-for-issue-closure):
   name every artefact by path. Attach the §5 gate evidence. Merge once Mobile CI is green.
6. **Build from the merge commit**, never from a dirty tree:
   ```bash
   cd apps/mobile
   git fetch origin main && git checkout <merge-sha>
   eas build --platform all --profile production
   ```
7. **Verify the build before submitting.** Install the artefact on a real device: Settings ›
   Status shows the new version and the intended environment, the connection test succeeds,
   sign-in works, and a push notification arrives (which proves token registration — see §7.3).
8. **Submit to the stores.**
   ```bash
   eas submit --platform ios --profile production --latest
   eas submit --platform android --profile production --latest
   ```
9. **Stage the rollout.** On Google Play start at 10% and hold for 24 hours; on iOS enable
   phased release. Do not go to 100% before the crash-free thresholds in §5 have been met on
   real traffic.
10. **Tag and record.** `git tag mobile-v<version> <merge-sha> && git push origin
    mobile-v<version>`. Write the build IDs and the rollback target — the previous tag and its
    store build number — into the release PR. §16 of the operations runbook requires a known
    rollback target before you promote.
11. **Watch for 48 hours:** crash-free rate, push delivery, API error rate. Do not start another
    release inside that window.

### 4.2 OTA update

Requires §0 to be complete. Use this only for a change that §3 lists as eligible.

1. **Confirm eligibility against §3.** If unsure, ship a store build instead.
2. Merge the change to `main` through normal review. An OTA is not a way around review.
3. Confirm Mobile CI is green on the merge commit.
4. **Publish to `preview` first**, always:
   ```bash
   cd apps/mobile
   eas update --branch preview --message "<what changed and why>"
   ```
5. **Verify on a device running a preview build:** relaunch twice (the first launch downloads,
   the second applies), check Settings › Status, and exercise the changed flow.
6. **Publish to production.**
   ```bash
   eas update --branch production --message "<what changed and why>"
   ```
7. **Record the update group ID** from the command output in the PR. You need it to roll back.
8. **Watch the crash-free rate for 24 hours.** An OTA reaches users within one or two app
   launches, so a regression surfaces much faster than with a store release — and so does the
   damage.

Never publish an OTA to `production` without publishing to `preview` first, and never as the
last action before going offline.

---

## 5. Release gates

All of these must pass on the exact commit being shipped. This applies to a store release and
to an OTA alike — an OTA is a production deployment.

### Required CI checks

`Mobile CI` ([.github/workflows/mobile.yml](../.github/workflows/mobile.yml)) runs on any PR
touching `apps/mobile/**` and must be green:

- **`mobile-checks`** — `npm run tsc -- --noEmit` and `npm run test:coverage`
- **`mobile-e2e`** — the Playwright smoke suite against the Expo web build (`npm run e2e`); the
  report uploads as an artifact on failure

If a release touches no files under `apps/mobile/**`, the path filter means Mobile CI will not
have run. Trigger it by hand — `workflow_dispatch`, or touch `apps/mobile/.ci-trigger` — rather
than shipping on a stale result.

Before a store release, also run
[Mobile E2E Flake Check](../.github/workflows/mobile-e2e-flake-check.yml) (`workflow_dispatch`,
ten consecutive suite runs). Investigate before shipping if any run fails: a flaky suite means
the green result on your release commit proves less than it appears to.

### Crash-free thresholds

Defined in [lib/release-readiness.ts](../apps/mobile/lib/release-readiness.ts) and, per the
comment there, the single source of truth this checklist references:

| Metric | Threshold | Constant |
|---|---|---|
| Crash-free **sessions** | ≥ 99% | `CRASH_FREE_SESSION_THRESHOLD = 0.99` |
| Crash-free **users** | ≥ 98% | `CRASH_FREE_USER_THRESHOLD = 0.98` |

Evaluate with the pure function rather than by eye:

```ts
import { evaluateReleaseReadiness } from './lib/release-readiness';

evaluateReleaseReadiness({
  releaseVersion: '1.1.0',
  crashFreeSessionRate: 0.994,
  crashFreeUserRate: 0.987,
});
// → { releaseVersion: '1.1.0', ready: true, reason: 'meets crash-free thresholds' }
```

It returns a `reason` naming the failing metric and its threshold. Paste the returned object
into the release PR — that is the gate evidence.

Apply it twice: to the **outgoing** version before widening a staged rollout, and to the
**current production** version before starting a new release. Shipping on top of an already
unhealthy release makes the regression impossible to attribute.

Note that `evaluateReleaseReadiness` has no caller today — it is a pure function driven by rates
you supply, from whatever crash reporting backend is wired up. The in-repo reporter
([lib/error-reporting.ts](../apps/mobile/lib/error-reporting.ts)) logs to the console and does
not aggregate rates, so for now these numbers come from the store consoles: App Store Connect
Metrics and Play Console Android vitals.

### Manual gates

- [ ] Release notes entry added for this version (§2).
- [ ] Verified on one physical iOS and one physical Android device — not only a simulator.
- [ ] Settings › Status reports the expected version and environment.
- [ ] Secrets for the target channel confirmed present (§6).
- [ ] Rollback target identified and written into the release PR (§4.1 step 10).
- [ ] No release-blocking alerts active
      ([TESTNET_OPERATIONS_RUNBOOK.md §2](TESTNET_OPERATIONS_RUNBOOK.md#2-release-readiness-gate)).

---

## 6. Environment and secret configuration per channel

All runtime configuration reaches the app through `EXPO_PUBLIC_*` variables read in
[lib/config.ts](../apps/mobile/lib/config.ts).

**`EXPO_PUBLIC_*` values are inlined into the JavaScript bundle at build time.** Two
consequences that matter for releases:

1. They are **not secret**. Anyone with the binary can read them. Never put an API key, signing
   key, or credential in one. The only true secrets in this pipeline are the store credentials
   and the EAS token, which live in EAS and never in the bundle.
2. Changing one requires a **new bundle**. A store build picks up the new value, and so does an
   OTA, since it rebundles. An already-installed binary does not — which also means an OTA can
   silently repoint an installed app at a different backend. Treat any endpoint change as a
   deliberate, verified action.

### Per channel

| Variable | `development` | `preview` | `production` |
|---|---|---|---|
| `EXPO_PUBLIC_APP_VARIANT` | `development` | `preview` | `production` — gates `validateEnvironmentConfig()` |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` | staging backend | production backend |
| `EXPO_PUBLIC_TESTNET_API_URL` | `http://localhost:3000` | staging backend | **required, non-localhost** |
| `EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | same | same |
| `EXPO_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID` | local deploy | testnet contract | testnet contract |
| `EXPO_PUBLIC_MAINNET_API_URL` | empty | empty | **required, non-localhost** |
| `EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL` | empty | empty | **required, non-localhost** |
| `EXPO_PUBLIC_MAINNET_CROWDFUND_CONTRACT_ID` | empty | empty | mainnet contract |
| `EXPO_PUBLIC_STELLAR_EXPLORER_URL` | `https://stellar.expert/explorer` | same | same |
| `EXPO_PUBLIC_STEP_UP_GRACE_PERIOD_MS` | `300000` | `300000` | `300000` |

The four rows marked **required** are exactly the ones `validateEnvironmentConfig()` throws on.
Leaving any of them empty in a production build ships an app that crashes on launch.

Local development copies [apps/mobile/.env.example](../apps/mobile/.env.example) to `.env`
(gitignored). CI and builds take their values from EAS environment variables, set per profile in
`eas.json` or with `eas secret:create --scope project --name <NAME> --value <value>`. `.env` is
never used for a `preview` or `production` build.

### Credentials, by holder

| Secret | Held in | Used for |
|---|---|---|
| iOS distribution certificate and provisioning profile | EAS managed credentials | `eas build --platform ios` |
| Android upload keystore | EAS managed credentials | `eas build --platform android` |
| App Store Connect API key | EAS | `eas submit --platform ios` |
| Google Play service account JSON | EAS | `eas submit --platform android` |
| `EXPO_TOKEN` | GitHub Actions repository secrets | Any future CI-driven build or update |

Never commit any of these. The Android upload keystore in particular cannot be regenerated —
losing it means losing the ability to update the listing.

---

## 7. Rollback

### 7.1 Rolling back an OTA update

The fast path — minutes, no store review. Always prefer it when the regression came from an OTA.

1. **Confirm the OTA is the cause.** Compare the crash signature's onset against the publish
   time of the update group recorded in §4.2 step 7. If the regression predates it, roll back
   the store release instead (§7.2).
2. **List recent update groups** for the affected branch:
   ```bash
   cd apps/mobile
   eas update:list --branch production
   ```
3. **Republish the last known-good group.** This is the rollback: it makes the good bundle the
   newest update, so clients move forward onto it.
   ```bash
   eas update:republish --group <last-known-good-group-id> \
     --message "Rollback of <bad-group-id>: <one-line reason>"
   ```
   Do not delete the bad group. Clients that already have it need a *newer* update to move off
   it, and you need it to diagnose.
4. **Verify on a device** that received the bad update: relaunch twice, confirm the version and
   the fixed behaviour.
5. **Watch the crash-free rate recover** to the §5 thresholds. Users who have not relaunched are
   still on the bad bundle, so recovery is gradual, not instant.
6. **If the OTA rollback does not recover the app** — for example the bad bundle crashes before
   the update check runs — the OTA path is closed and you must go to §7.2. This is the failure
   mode that makes a crash on launch categorically worse than one after launch.
7. **Record it:** open an issue with the bad group ID, the good group ID, the onset and recovery
   times, and why §4.2 step 5 did not catch it.

### 7.2 Rolling back a store release

Slower. Neither store has "unpublish to previous version": rollback means halting the rollout
and then shipping a *newer* build that contains the old code.

1. **Halt the rollout immediately**, before anything else. Google Play: release management → halt
   the staged rollout. iOS: App Store Connect → pause the phased release. This stops new users
   receiving the bad build; it does not remove it from anyone who has it.
2. **Check whether an OTA can fix it instead.** If the regression is purely JS and the bad
   binary's `runtimeVersion` still matches, publish a fix or a republished good bundle via §7.1 —
   minutes instead of days. This is the main reason `runtimeVersion` discipline matters.
3. **If OTA cannot fix it, prepare a revert build:**
   ```bash
   git checkout -b hotfix/mobile-v<new-version> mobile-v<last-good-version>
   ```
   Bump `expo.version` **forward** (for example 1.1.0 → 1.1.1). Never reuse a version or build
   number; the stores reject it. Add a release-notes entry naming it as a revert.
4. **Build and submit as expedited.** iOS: request an expedited review and state that it reverts
   a crashing release. Android: submit at 100%, since a staged rollout of a fix helps nobody.
5. **While waiting for review**, limit the blast radius: on Google Play you can resume the
   rollout of the prior release track; on iOS, leaving the phased release paused keeps the bad
   build from reaching the remaining users.
6. **Verify on a device** once approved, then roll out to 100%.
7. **Post-incident:** follow
   [INCIDENT_POSTMORTEM_WORKFLOW.md](INCIDENT_POSTMORTEM_WORKFLOW.md). A store rollback is by
   definition a gate failure — §5 passed on something that should not have shipped. Fix the gate,
   not just the bug.

### 7.3 What rollback does not undo

- **Push tokens.** Registration and deregistration run through
  [lib/push-token.ts](../apps/mobile/lib/push-token.ts) against `/notification-devices`, keyed by
  a device ID persisted in secure storage. A release that deregistered devices — for example by
  changing sign-out behaviour in
  [contexts/AuthContext.tsx](../apps/mobile/contexts/AuthContext.tsx) — leaves them deregistered
  after the rollback. Users must reopen the app for
  [contexts/NotificationsContext.tsx](../apps/mobile/contexts/NotificationsContext.tsx) to
  re-register.
- **Persisted local state.** The selected environment (`@lumenpulse_environment`), cached data,
  saved drafts, and the queued mutations in `lib/mutation-queue.ts` all survive. A release that
  wrote a bad value or an incompatible cache shape needs a migration or a targeted clear in the
  fix build; rolling back the code does not clean it up.
- **Server-side effects.** Anything the bad release wrote through the API stays written.

---

## 8. Post-release verification

Within an hour of a store rollout or an OTA reaching production:

- [ ] Settings › Status shows the new version, the expected environment, and a successful
      connection test.
- [ ] A push notification is delivered to a device updated to the new release.
- [ ] Sign-in, wallet linking, and one contribution flow work end to end.
- [ ] Crash-free rates are being reported for the new version in the store consoles.
- [ ] The release PR records the tag, build IDs, update group ID where applicable, and the
      rollback target.
