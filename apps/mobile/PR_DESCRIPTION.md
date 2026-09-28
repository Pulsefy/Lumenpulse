## Description

Adds a mobile search screen backed by the projects, assets, ecosystem, and entity-links APIs. Search is available from the tab bar, groups results with per-group counts, cancels outdated requests, and stores recent searches locally with a privacy-screen clear option.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Files Modified

- Added the typed search API client and recent-search storage.
- Added the searchable tab screen and tab navigation entry.
- Added recent-search clearing to Data & Privacy and local-data inventory.
- Migrated QR scanning to the SDK-compatible `expo-camera` module, aligned native dependencies with Expo SDK 54, and enabled the architecture required by Reanimated 4.
- Updated English and Chinese localization and mobile tests.

## Testing

- [x] Tested locally
- [x] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes)

## Code Quality checks

- [x] Mobile TypeScript check
- [x] Mobile Jest test suite
- [x] Expo dependency compatibility check
- [x] Expo config validation
- [x] ESLint and Prettier checks

# Behavioural Changes

- Users can search projects, Stellar assets, ecosystem tags/categories, and linked entities from the mobile tab bar.
- Search requests are debounced and cancelled when the query changes.
- Up to 10 recent searches persist locally and can be cleared from Data & Privacy.
- QR scanning uses Expo Camera; native builds must be rebuilt to include the updated native modules.

## Related Issues

Closes #
