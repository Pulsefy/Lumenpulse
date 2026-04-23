# Mobile Contribution Guide

This guide covers app-specific standards for `apps/mobile`.

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

## Done for Mobile Changes

- `npm run lint` passes.
- `npm run tsc` passes.
- Behavior is verified on emulator/simulator or physical device.
- Relevant docs are updated.
