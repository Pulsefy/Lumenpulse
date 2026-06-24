# Deep Linking — QA Testing Guide

## Supported Deep Link Patterns

| Pattern | Destination | Status |
|---|---|---|
| `mobile://grants/{id}` | Grant round detail screen (`/(tabs)/grants/[id].tsx`) | Supported |
| `mobile://grants/{id}/summary` | Grant round detail screen (`/(tabs)/grants/[id].tsx`) | Supported (route matches `[id]` param) |
| Anything else (non-matching) | Redirected by `+not-found.tsx` | Graceful fallback |

## URL scheme

The app registers the `mobile://` URI scheme (configured in `app.json`). On iOS this maps to `com.lumenpulse.mobile://`; on Android it is `mobile://`.

## How It Works

### Architecture

1. **`contexts/DeepLinkContext.tsx`** — A React context that listens for incoming deep-link URLs via:
   - `Linking.getInitialURL()` — captures URLs when the app is cold-started
   - `Linking.addEventListener('url', ...)` — captures URLs when the app is already open or in the background
   - Parses supported patterns and stores any pending deep link as state

2. **Expo Router automatic routing** — When the app receives a `mobile://grants/123` URL, Expo Router
   automatically resolves the path `/grants/123` against the file-system route tree and navigates to
   `(tabs)/grants/[id].tsx`.

3. **`ProtectedRoute`** — Both the grants list screen (`grants/index.tsx`) and grant round detail
   screen (`grants/[id].tsx`) are now wrapped with `<ProtectedRoute>`. This ensures:
   - The auth token is loaded from SecureStore before any API calls are made
   - Unauthenticated users are redirected to `/auth/login`
   - The cold-start race condition (navigation arriving before auth readiness) is eliminated

### Cold-Start Flow

1. App is fully terminated
2. User taps a shared link: `mobile://grants/42`
3. OS launches the app with the URL
4. Providers mount in order: Localization → Environment → BiometricLockGuard → Auth → Wallet → Notifications
5. **DeepLinkProvider** mounts and calls `Linking.getInitialURL()` — captures `mobile://grants/42`
6. Expo Router resolves the path to `/(tabs)/grants/[id]`
7. `[id].tsx` renders, but **ProtectedRoute** shows a loading spinner while `AuthProvider` checks
   for a stored token
8. Once auth is confirmed, `GrantRoundDetailContent` renders and calls the API with the auth token
9. Grant round data loads and the detail screen displays

### Background / Already-Open Flow

1. App is open (foreground or background)
2. System delivers a URL via `Linking.addEventListener('url', ...)`
3. Expo Router immediately navigates to the matching route
4. `ProtectedRoute` re-checks auth (if user is already authenticated, passes through instantly)
5. Screen renders normally

## Test Cases

### TC-1: Valid grant round link (app in foreground)

**Setup**: App is open and user is authenticated.

**Steps**:
1. Open the app and log in
2. From a terminal on a connected device/emulator, run:
   - iOS: `xcrun simctl openurl booted "mobile://grants/1"`
   - Android: `adb shell am start -W -a android.intent.action.VIEW -d "mobile://grants/1"`

**Expected**: App navigates to the grant round detail screen for round ID 1. Data loads correctly.

### TC-2: Valid grant round link (cold start)

**Setup**: App is fully terminated, user has an active session.

**Steps**:
1. Kill the app entirely
2. Send the deep link via terminal (see commands in TC-1)

**Expected**: App launches, briefly shows "Checking authentication..." then the grant round
detail screen for the specified round. Data loads correctly.

### TC-3: Valid grant round link (background)

**Setup**: App is open but backgrounded, user is authenticated.

**Steps**:
1. Open the app and log in
2. Press Home (iOS) or Overview (Android) to background the app
3. Send the deep link via terminal

**Expected**: App comes to foreground, navigates to the grant round detail screen. Data loads correctly.

### TC-4: Unknown route

**Setup**: App is open, user is authenticated.

**Steps**:
1. Send a deep link with an unknown path: `mobile://some-unknown-path`

**Expected**: App navigates to the `+not-found.tsx` route, which redirects to the Home screen.

### TC-5: Invalid grant round ID (non-numeric)

**Setup**: App is open, user is authenticated.

**Steps**:
1. Send a deep link: `mobile://grants/abc`

**Expected**: App navigates to the grant round detail screen. `parseInt("abc")` returns `NaN`,
API call fails with a 404 (or similar), error UI displays with an alert icon, message, and
"Retry" button. App does not crash.

### TC-6: Non-existent / deleted grant round

**Setup**: App is open, user is authenticated.

**Steps**:
1. Send a deep link: `mobile://grants/999999` (or an ID that does not exist)

**Expected**: App navigates to the grant round detail screen. API returns an error (404).
Error UI displays with a message (e.g. "Could not load round") and a "Retry" button.
App does not crash.

### TC-7: Unauthenticated user

**Setup**: App is open, user is NOT logged in.

**Steps**:
1. Log out if logged in
2. Send a deep link: `mobile://grants/1`

**Expected**: App navigates toward the grant round screen, but `ProtectedRoute` detects the
user is not authenticated and redirects to `/auth/login`.

### TC-8: Malformed URL

**Setup**: App is open.

**Steps**:
1. Send a deep link with a non-standard format: `mobile:///grants/1` or `mobile:grants/1`

**Expected**: App handles the URL gracefully. The `parseDeepLink` function in `DeepLinkContext`
returns `null` for unrecognised patterns. No crash, no error screen — the URL is simply
ignored (and Expo Router's default handling may or may not show the route depending on
whether it matches).

### TC-9: Existing navigation preserved

**Setup**: App is open, user is authenticated.

**Steps**:
1. Navigate normally through the app: Home → Grants → tap a round card
2. Navigate back using the hardware/software back button
3. Use tab bar to switch between tabs

**Expected**: All existing navigation behavior is unchanged. The grants screens look and
behave identically to before. The only difference is that `ProtectedRoute` now wraps them,
which adds a brief auth check on mount.

## Cold-Start Testing Procedure

1. **Ensure user has an active session** (token stored in SecureStore)
2. **Fully terminate the app**:
   - iOS: Swipe up on the app in the app switcher
   - Android: Force-stop the app from Settings → Apps → Lumenpulse → Force Stop
3. **Send a deep link**:
   - iOS Simulator:
     ```bash
     xcrun simctl openurl booted "mobile://grants/1"
     ```
   - Android Emulator:
     ```bash
     adb shell am start -W -a android.intent.action.VIEW -d "mobile://grants/1"
     ```
   - Physical device: Tap a link on a web page that uses the `mobile://` scheme, or
     use a QR code that encodes the URL
4. **Observe**: App should launch, show brief auth check, then display the grant round

## Invalid-Link Testing Procedure

1. App is open and authenticated
2. Send each of these links and verify no crash:
   - `mobile://grants/abc` — invalid ID
   - `mobile://grants/` — missing ID
   - `mobile://` — empty path
   - `mobile://unknown/route` — non-existent route
   - `mobile://grant-round/1` — alternative unsupported pattern (should go to `+not-found`)

## Edge-Case Testing

| Edge Case | Expected Behavior |
|---|---|
| Deep link arrives before biometric unlock completes | BiometricLockGuard shows lock screen. After unlock, Expo Router processes the initial URL normally |
| Deep link arrives while auth check is in progress | ProtectedRoute shows "Checking authentication..." then resolves to either grant screen or login redirect |
| Rapid successive deep links | Each URL is processed independently. The last navigation wins |
| Deep link when offline | Grant screen shows loading, API call fails, error UI displays with retry |
| Deep link to expired grant round | API returns error (likely 404 or 410), error UI displays with retry |
| Deep link with query parameters (`mobile://grants/1?ref=share`) | Expo Router ignores query params for route matching. Params available via `useLocalSearchParams()` |
| Universal link domain (`https://lumenpulse.app/grants/1`) | Requires native configuration (Apple App Site Association / Android Asset Links) — not yet implemented |

## Debugging

To see deep link events in the console:

```tsx
// Add to DeepLinkContext useEffect:
console.log('DeepLinkContext: initial URL:', url);
console.log('DeepLinkContext: parsed:', info);
```

During development, you can also test deep links by running:

```bash
# iOS Simulator
xcrun simctl openurl booted "mobile://grants/1"

# Android Emulator
adb shell am start -W -a android.intent.action.VIEW -d "mobile://grants/1"

# Expo Go (development)
# Use Linking.openURL() from a debug console:
npx expo start --ios
# Then in another terminal:
xcrun simctl openurl booted "exp+{your-project-slug}://grants/1"
```

## Files Modified

| File | Change |
|---|---|
| `contexts/DeepLinkContext.tsx` | **NEW** — Deep link parsing and pending-link state |
| `app/_layout.tsx` | Added `<DeepLinkProvider>` to provider tree |
| `app/(tabs)/grants/[id].tsx` | Wrapped with `<ProtectedRoute>` to prevent auth race condition |
| `app/(tabs)/grants/index.tsx` | Wrapped with `<ProtectedRoute>` for consistency |
| `document/QA_DEEP_LINKING.md` | **NEW** — This document |

## Limitations

1. **Universal Links / App Links** not yet configured — only `mobile://` custom scheme deep links are supported. For production deployment, Apple App Site Association and Android Asset Links files need to be set up for the domain.
2. **No route alias** — `mobile://grants/{id}` is the only supported pattern. An alias like `mobile://grant-round/{id}` would require additional routing configuration.
3. **No analytics tracking** — The `DeepLinkContext` captures parsed deep links but does not yet send analytics events.
