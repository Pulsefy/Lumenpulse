# Mobile Contribution Guide

This guide covers app-specific standards for `apps/mobile`. The mobile app integrates Stellar wallets. For migration context, see [Stellar Migration Notes](STELLAR_MIGRATION_NOTES.md).

## Setup

```bash
cd apps/mobile
npm install
```

## Daily Commands

```bash
# Start Expo
npm run start

# Static checks
npm run lint
npm run tsc

# Optional formatting
npm run format
```

## Standards

- Use TypeScript with explicit types for API and state data.
- Keep components functional and hook-based.
- Avoid inline styles when reusable `StyleSheet` styles are appropriate.
- Include UI proof (screenshots or screen recording) in PRs for visual changes.

## Releases

Cutting a release, publishing an OTA update, rolling either back, and the gates that must pass
first are documented in
[Mobile Release and OTA Process](MOBILE_RELEASE_AND_OTA.md). Read it before bumping a version
or publishing an update.

## Done for Mobile Changes

- `npm run lint` passes.
- `npm run tsc` passes.
- Behavior is verified on emulator/simulator or physical device.
- Relevant docs are updated.
