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

1. **Install Dependencies**:

   ```bash
   pnpm install
   ```

2. **Setup Environment**:

   ```bash
   cp .env.example .env
   ```

3. **Start the Development Server**:

   ```bash
   pnpm start
   ```

4. **Run on Platforms**:
   - Press `a` for Android Emulator.
   - Press `i` for iOS Simulator.
   - Press `w` for Web.
   - Scan the QR code with Expo Go to run on a physical device.

## Scripts

- `pnpm start`: Start Expo dev server.
- `pnpm android`: Open on Android.
- `pnpm ios`: Open on iOS.
- `pnpm web`: Open as a progressive web app.
- `pnpm lint`: Run ESLint.
- `pnpm tsc`: Run TypeScript compiler check.

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
