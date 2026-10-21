# Lumenpulse Mobile 🚀

Lumenpulse Mobile is the cross-platform mobile client for the Lumenpulse ecosystem, built with Expo and TypeScript. It provides real-time crypto news aggregation and portfolio tracking on the go.

## Features (In Progress)

- **News Feed**: Aggregated news from top sources with sentiment analysis.
- **Portfolio Tracking**: Real-time asset monitoring and performance metrics.
- **On-chain Rewards**: Earn rewards for community contributions.

## Prerequisites

- **Node.js**: use the version in the repository's `.nvmrc`.
- **npm**: included with Node.js; mobile CI uses `package-lock.json` and `npm ci`.
- **Expo Go**: Download on iOS/Android for physical device testing.

## Getting Started

1. **Install Dependencies**:

   ```bash
   # From the repository root (Metro also needs the root tooling):
   npm install --no-audit --no-fund
   cd apps/mobile
   npm ci
   ```

2. **Setup Environment**:

   ```bash
   cp .env.example .env
   ```

3. **Start the Development Server**:

   ```bash
   npm run start
   ```

4. **Run on Platforms**:
   - Press `a` for Android Emulator.
   - Press `i` for iOS Simulator.
   - Press `w` for Web.
   - Scan the QR code with Expo Go to run on a physical device.

## Scripts

- `npm run start`: Start Expo dev server.
- `npm run android`: Open on Android.
- `npm run ios`: Open on iOS.
- `npm run web`: Open as a progressive web app.
- `npm run lint`: Run ESLint.
- `npm run tsc`: Run TypeScript compiler check.

The workspace's root `pnpm-lock.yaml` is maintained for pnpm users; there is no
separate mobile pnpm lockfile. See the [dependency audit](docs/dependency-audit-2026-10-19.md)
for dependency decisions, remaining advisories and reproducible size measurements.

## Wallet Adapters

Production builds use the SEP-0007 wallet adapter only. Development builds may
also select the mock adapter when the SEP-0007 wallet is unavailable; the app
shows a persistent warning while that adapter is active, and mock transactions
are never real signatures.

## Validation

- Secure session and wallet metadata validation steps live in [SECURE_STORAGE_VALIDATION.md](./SECURE_STORAGE_VALIDATION.md).
- Coverage floor: the mobile Jest config enforces a minimum global coverage threshold as a baseline floor to raise over time. The current floor is intentionally set to the achieved level so the build stays green while we expand the test matrix.

## Architecture

The app follows a modern Expo Router structure with the following key components:

### Directory Structure

- `app/` - Expo Router pages and navigation
- `components/` - Reusable UI components
- `contexts/` - React Context providers (Auth, etc.)
- `lib/` - Core utilities and services
  - `api-client.ts` - HTTP client with typed methods
  - `api.ts` - Domain-specific API services
  - `config.ts` - Environment configuration
  - `storage.ts` - Secure storage utilities

### API Client

The app uses a centralized API client for all backend communication. See [lib/API_CLIENT_README.md](./lib/API_CLIENT_README.md) for detailed documentation.

Quick example:

```typescript
import { apiClient } from '@/lib/api-client';
import { authApi, healthApi } from '@/lib/api';

// Health check
const response = await healthApi.check();
if (response.success) {
  console.log('Backend is healthy:', response.data);
}

// Login
const loginResponse = await authApi.login({
  email: 'user@example.com',
  password: 'password',
});
```

Key features:

- Typed HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Consistent error handling with normalized error shapes
- Environment-based configuration (no hardcoded URLs)
- Automatic auth token management
- Request timeout and cancellation support

### Styling

Styling is handled via standard `StyleSheet` with a custom dark theme design system.
