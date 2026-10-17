# Mobile Guide

## Session Timeout and Re-Authentication Policy

The mobile app enforces a session timeout so that an unlocked device does not keep a
valid session indefinitely. The policy is implemented in `lib/session-timeout.ts` and
integrates with the biometric lock in `lib/biometric-lock.ts`.

### Behavior

- **Inactivity timeout.** If the user is inactive for the configured timeout, the
  app locks and requires re-authentication (biometric or device passcode).
  "Inactivity" is reset by user interaction via `recordActivity()`.
- **Background lock.** If the app is backgrounded for longer than the
  `BACKGROUND_LOCK_THRESHOLD_MS` threshold (30 seconds), the app locks on return
  regardless of the inactivity timer.
- **Unlock.** After successful re-authentication, call `unlock()` to reset the timers
  and clear the lock state.

### Configuration Bounds

The inactivity timeout is user-adjustable within documented bounds:

| Setting | Value |
| --- | --- |
| Minimum | 30 seconds (`MIN_SESSION_TIMEOUT_MS`) |
| Default | 5 minutes (`DEFAULT_SESSION_TIMEOUT_MS`) |
| Maximum | 30 minutes (`MAX_SESSION_TIMEOUT_MS`) |

Call `setSessionTimeoutMs(value)` to persist a user preference. Values outside the
bounds are clamped automatically via `clampInactivityTimeout`. Read the current
preference with `getSessionTimeoutMs`.

### Unsaved Input

The lock is a UI state change and must not unmount or discard in-progress forms.
When the lock screen is shown, preserve the underlying screen stack and any form
state, including contribution drafts. After re-authentication the user resumes exactly
where they left off. Drafts should also be persisted locally so a process kill
during the lock does not lose input.

### Integration Example

```ts
import { sessionTimeoutManager } from './session-timeout';

// Attach the AppState listener once at app startup.
sessionTimeoutManager.attachAppStateListener();

// Subscribe to lock events to show the lock screen.
const unsubscribe = sessionTimeoutManager.onLock(() => {
  showLockScreen();
});

// Record activity on user interaction (e.g. PanResponder or navigation events).
sessionTimeoutManager.recordActivity();

// After successful re-authentication:
sessionTimeoutManager.unlock();
```

### Tests

The policy is covered by `lib/session-timeout.test.ts`, which verifies inactivity
locking, background lock thresholds, activity resets, listener notifications, and config
bound clamping.
