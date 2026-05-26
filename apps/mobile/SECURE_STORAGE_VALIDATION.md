# Secure Storage Validation

This checklist covers the secure session and wallet metadata changes in `apps/mobile`.

## Manual validation

1. Start the mobile app with `pnpm start` from `apps/mobile` and sign in with a test account.
2. Inspect device storage with Expo tooling, Flipper, or your platform debugger.
3. Confirm `auth_token`, `refresh_token`, legacy `token`, and `user` entries are not present in `AsyncStorage`.
4. Confirm the signed-in session survives an app restart, which verifies the token now comes back from `expo-secure-store`.
5. Open Manage Accounts, link a Stellar account, force close the app, and reopen it.
6. Confirm the linked account list repopulates immediately from local wallet metadata and then refreshes from the API.
7. Remove a linked account and confirm the cached list updates after the API call completes.
8. Use Settings -> Logout.
9. Confirm protected screens redirect back to `/auth/login`.
10. Inspect storage again and confirm secure auth state and cached wallet metadata were cleared.

## Notes

- Legacy plaintext auth keys are migrated out of `AsyncStorage` the first time the new storage layer loads them.
- Wallet persistence only stores non-secret metadata: linked account ids, public keys, labels, timestamps, and the active public key.
