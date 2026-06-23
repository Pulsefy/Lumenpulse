# Manual Test Cases — Wallet Disconnect & Session Cleanup

## TC-1: Disconnect wallet from Web App

**Preconditions:**
- Freighter wallet extension is installed and unlocked
- User is on the LumenPulse webapp with a connected wallet

**Steps:**
1. Observe that the navbar shows the truncated wallet address (e.g. `GBXXXX...XXXX`)
2. Click the red disconnect (LogOut) button next to the wallet address
3. Verify the navbar changes to show "Connect Wallet" button
4. Verify no wallet address is displayed anywhere in the UI
5. Open browser DevTools → Application → Local Storage / Session Storage
6. Verify no `stellar_wallet_public_key` key remains in localStorage
7. Verify sessionStorage is empty

**Expected result:**
- Wallet state is fully cleared
- UI shows "Connect Wallet" (no stale address)
- No wallet-related data in browser storage

---

## TC-2: Logout from Mobile App

**Preconditions:**
- User is logged into the mobile app via email/password
- User has linked at least one Stellar account in Settings → Manage Accounts

**Steps:**
1. Navigate to Settings tab
2. Tap "Log Out" button
3. Observe that the app navigates to the login screen
4. Verify that pressing the device back button does NOT return to the previous authenticated screen
5. Open a debug menu / check AsyncStorage via a dev tool
6. Verify that `auth_token`, `refresh_token`, `cached_linked_accounts`, `cached_portfolio_summary`, and `cached_transactions` keys are all removed

**Expected result:**
- App redirects to login screen
- All session and wallet-cached data is purged from AsyncStorage
- Backend refresh token is revoked (verified in TC-5)

---

## TC-3: Reconnect after Cleanup (Web App)

**Preconditions:**
- TC-1 has been completed (wallet disconnected)

**Steps:**
1. Click "Connect Wallet" button
2. In the modal, click "Freighter"
3. Freighter extension prompts for approval — approve the connection
4. Verify the navbar now shows the connected wallet address
5. Verify `status` is "connected" and no error is displayed

**Expected result:**
- Wallet reconnects cleanly without any stale state interference
- Fresh wallet address is displayed

---

## TC-4: Reconnect after Cleanup (Mobile App)

**Preconditions:**
- TC-2 has been completed (logged out)

**Steps:**
1. Enter email and password for the same account used before
2. Tap "Log In"
3. Verify that the app navigates to the home screen
4. Navigate to Settings → Manage Accounts
5. Verify that previously linked accounts appear (fetched fresh from backend, not from stale cache)

**Expected result:**
- Login succeeds
- Account data is fetched fresh from the backend
- No stale cached data appears

---

## TC-5: Backend Token Revocation Verification

**Preconditions:**
- Backend logs are accessible
- User has an active session on the mobile app

**Steps:**
1. Note the `refresh_token` value (via debug logging or API inspection)
2. Perform logout from the mobile app (TC-2)
3. Immediately attempt to call `POST /auth/refresh` with the old refresh token
4. Verify the backend returns `401 Unauthorized` with message "Invalid or revoked refresh token"
5. Check backend logs for entry: `User logged out, refresh token revoked for user {id}`

**Expected result:**
- Refresh token is marked as `revokedAt` in the database
- Any subsequent use of the old refresh token is rejected

---

## TC-6: No Stale UI after Logout

**Preconditions:**
- User is logged into mobile app with portfolio data visible

**Steps:**
1. Navigate to Portfolio tab — note the displayed balance
2. While the portfolio screen is still in the stack, tap Settings → Log Out
3. After being redirected to login, use the device gesture to go "back"
4. Verify the app does NOT show the portfolio screen with old data
5. Log back in and verify the portfolio loads fresh data

**Expected result:**
- Protected screens are not accessible after logout
- No stale UI is visible from the previous session

---

## TC-7: Logout-All (multi-device)

**Preconditions:**
- User is logged in on two mobile devices or two browser tabs

**Steps:**
1. On device A, navigate to a screen that calls `authApi.logoutAll()` (or call via API client directly)
2. On device B, attempt to perform an authenticated API call
3. Verify device B receives a `401 Unauthorized` response

**Expected result:**
- All refresh tokens for the user are revoked
- All other sessions are invalidated immediately

---

## Environment Setup for Testing

| Component | How to start |
|-----------|-------------|
| Backend | `cd apps/backend && npm run start:dev` |
| Mobile app | `cd apps/mobile && npm start` |
| Web app | `cd apps/webapp && npm run dev` |
| AsyncStorage debug | Use `react-native-debugger` or Chrome DevTools for Web SQL |
