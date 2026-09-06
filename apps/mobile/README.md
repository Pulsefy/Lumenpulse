# Lumenpulse Mobile 🚀

Lumenpulse Mobile is the cross-platform mobile client for the Lumenpulse ecosystem, built with Expo and TypeScript. It provides real-time crypto news aggregation and portfolio tracking on the go.

## Features (In Progress)

- **News Feed**: Aggregated news from top sources with sentiment analysis.
- **Portfolio Tracking**: Real-time asset monitoring and performance metrics.
- **On-chain Rewards**: Earn rewards for community contributions.

## Prerequisites

- **Node.js**: 18.x or later
- **pnpm**: `npm install -g pnpm`
- **Expo Go**: Download on iOS/Android for physical device testing.

## Getting Started

1. *Install Dependencies**:
   ```bash
   pnpm install
   ```\
2. *Setup Environment**:
   ```bash
   cp .env.example .env
   ```\
3. *Start the Development Server**:
   ```bash
   pnpm start
   ```\
4. *Run on Platforms**:
   - Press \"a\" for Android Emulator.
   - Press \"i\" for iOS Simulator.
   - Press \"w\" for Web.
   - Scan the QR code with Expo Go to run on a physical device.

## Scripts

- `pnpm start`: Start Expo dev server.
- `pnpm android`: Open on Android.
- `pnpm ioc`: Open on iOS.
- `pnpm web`: Open as a progressive web app.
- `pnpm lint`: Run ESLint.
- `pnpm tsc`: Run TypeScript compiler check.
- `pnpm check:locales`: Verify locale completeness and detect hardcoded user-facing strings.

## Localization

The app uses `react-i18next` (`~i18next`) with resources located in `locales/`.

To add a new locale:

1. Create `locales/<lang>.json` with the same nested structure as `en.json`.
2. Import it in `i18n.ts` and add it to the `resources` object.
3. Run `pnpm check:locales` to ensure your locale has complete coverage and that no user-facing strings are hardcoded in the UI</lang>codebase.

The check fails if `zh`,> fr", "" "" or any other locale is missing a key found in `en.json`. It also scans the app for double-quotes using JSX text and reports untranslated strings.
