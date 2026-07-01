# Manual Test Cases — Wallet Disconnect Session Cleanup

## Prerequisites
- Browser with Freighter extension installed and a funded Stellar wallet
- App running locally (`npm run dev`)

---

## TC-1: Wallet disconnect clears localStorage entries

**Steps:**
1. Connect a Stellar wallet via Freighter
2. Verify these keys exist in `localStorage` (via DevTools → Application → Local Storage):
   - `lumenpulse_wallet_previously_connected` = `"true"`
   - `lumenpulse_wallet_last_address` = `"<your-public-key>"`
   - `lumenpulse_watchlist_<your-public-key>` (after saving at least one project to watchlist)
   - `activeWalletId`
3. Click the disconnect button in the UI header
4. Verify all of the above keys are **removed** from `localStorage`

**Expected:** All wallet-scoped keys are cleaned up.

---

## TC-2: No stale session UI after disconnect

**Steps:**
1. Connect a wallet
2. Note the wallet button shows the truncated address (e.g., `GA3...F4K`)
3. Disconnect
4. Verify the UI immediately reverts to a "Connect Wallet" button
5. Verify no account summary / wallet address fragments remain visible

**Expected:** No stale wallet UI is visible after disconnect.

---

## TC-3: Reconnect after cleanup works cleanly

**Steps:**
1. Connect wallet → disconnect → refresh page → connect again
2. Verify connection succeeds, address appears correctly
3. Save a project to the watchlist
4. Disconnect, then reconnect with the same wallet
5. Verify watchlist is empty (clean slate)

**Expected:** Reconnection works without errors; watchlist reflects the new session.

---

## TC-4: Hook state is cleared on disconnect (useStellarAccount)

**Steps:**
1. Connect wallet with an active account that has balances and transactions
2. Open DevTools and set a breakpoint in `useStellarAccount.ts` after the fetch
3. Disconnect, verify `balances` and `transactions` arrays are reset to `[]`
4. Optionally inspect by rendering `publicKey` and `balances` in a temporary debug component

**Expected:** The hook does not retain stale balance/transaction data after publicKey is nulled.

---

## TC-5: Mobile wallet disconnect clears SecureStore metadata

**Steps (mobile/Expo app):**
1. Connect a wallet on mobile
2. Verify `wallet_metadata` exists in SecureStore
3. Disconnect
4. Verify `wallet_metadata` is removed from SecureStore
5. Reconnect and confirm the wallet connection flow starts fresh

**Expected:** Mobile wallet metadata is cleared on disconnect, preventing stale state on reconnect.

---

## TC-6: Previously connected status is not re-triggered after disconnect

**Steps:**
1. Connect wallet
2. Disconnect
3. Refresh the page
4. Verify the app does **not** show "previously_connected" banner/status
5. Verify the button shows "Connect Wallet", not "Reconnect"

**Expected:** Disconnect fully resets the persisted `lumenpulse_wallet_previously_connected` flag.

---

## Edge Cases

| Scenario | Expected |
|----------|----------|
| Disconnect when already disconnected | No errors; state stays "disconnected" |
| Disconnect in a new tab while app is open in another tab | Active tab picks up disconnected state on next interaction |
| Multiple connect/disconnect cycles in one session | Each disconnect fully clears state; each connect starts fresh |
| Disconnect with no watchlist data | No error; disconnect proceeds normally |
