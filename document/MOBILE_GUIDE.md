# Lumenpulse Mobile — Developer Guide

A step-by-step guide for new contributors to go from a fresh clone to a running simulator, and to understand the codebase well enough to contribute effectively.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Running the App](#running-the-app)
4. [Folder Structure](#folder-structure)
5. [Routing — Expo Router & the `app/(tabs)` Structure](#routing--expo-router--the-apptabs-structure)
6. [Environment Configuration](#environment-configuration)
7. [Running Against Local Backend vs Production](#running-against-local-backend-vs-production)
8. [Styling](#styling)
9. [Shared Components & Key Utilities](#shared-components--key-utilities)
10. [Available Scripts](#available-scripts)
11. [Common Issues](#common-issues)

---

## Prerequisites

Install all of these before cloning.

**Runtime & Package Manager**

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18.x or later | [nodejs.org](https://nodejs.org) |
| pnpm | latest | `npm install -g pnpm` |

**Expo Tooling**

```bash
npm install -g expo-cli
```

**For iOS (macOS only)**

- Xcode 14+ — install from the Mac App Store
- Xcode Command Line Tools: `xcode-select --install`
- iOS Simulator is bundled with Xcode (no separate install needed)
- CocoaPods: `sudo gem install cocoapods`

**For Android**

- [Android Studio](https://developer.android.com/studio) — includes the Android emulator
- During Android Studio setup, install the following via SDK Manager:
  - Android SDK Platform (API Level 33 or higher)
  - Android Emulator
  - Android SDK Platform-Tools
- Set the `ANDROID_HOME` environment variable (Android Studio will prompt you)

**Physical Device Testing**

- Install **Expo Go** from the [App Store](https://apps.apple.com/app/expo-go/id982107779) or [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)
- Your phone and development machine must be on the same Wi-Fi network

> **Note:** The app uses Expo SDK ~54 and React Native 0.81.5. Expo Go supports specific SDK versions — if you encounter a version mismatch, use the Expo Dev Client instead (see `expo-dev-client` in `package.json`).

---

## Initial Setup

### 1. Fork & Clone

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/<your-username>/lumenpulse.git
cd lumenpulse
```

### 2. Create a feature branch

```bash
git checkout -b docs/mobile-developer-guide
```

### 3. Install dependencies for the mobile app

```bash
cd apps/mobile
pnpm install
```

### 4. Set up environment variables

There is no `.env.example` file yet — create `.env` manually in `apps/mobile/`:

```bash
# apps/mobile/.env
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_APP_VARIANT=development
```

The `EXPO_PUBLIC_` prefix is required by Expo. Any variable without this prefix will not be available in the app bundle.

---

## Running the App

Start the Expo development server from inside `apps/mobile/`:

```bash
pnpm start
```

Once the Metro bundler is running, use the following keyboard shortcuts in the terminal:

| Key | Action |
|-----|--------|
| `a` | Open on Android emulator |
| `i` | Open on iOS simulator |
| `w` | Open in browser (web) |
| `r` | Reload the app |
| `m` | Toggle the dev menu |

Or scan the QR code printed in the terminal with the **Expo Go** app on your phone.

**Platform-specific quick launch:**

```bash
pnpm android   # Opens directly on Android emulator
pnpm ios       # Opens directly on iOS simulator
pnpm web       # Opens in browser
```

---

## Folder Structure

```
apps/mobile/
├── app/                      # All screens and navigation (Expo Router)
│   ├── _layout.tsx           # Root layout — wraps the entire app (providers, fonts)
│   ├── +not-found.tsx        # 404 screen for unmatched routes
│   ├── (tabs)/               # Tab navigator group
│   │   ├── _layout.tsx       # Defines the bottom tab bar and its tabs
│   │   ├── index.tsx         # Home tab screen
│   │   ├── portfolio.tsx     # Portfolio tab screen
│   │   ├── settings.tsx      # Settings tab screen
│   │   └── news/             # News stack nested inside tabs
│   │       ├── _layout.tsx   # Stack navigator for news
│   │       ├── index.tsx     # News list screen
│   │       └── [id].tsx      # Dynamic route — individual article
│   └── auth/                 # Auth screens (outside the tab navigator)
│       ├── _layout.tsx       # Auth stack layout
│       ├── login.tsx         # Login screen
│       └── register.tsx      # Register screen
│
├── components/               # Reusable UI components
│   └── ProtectedRoute.tsx    # Wraps screens that require authentication
│
├── contexts/                 # React Context providers
│   ├── AuthContext.tsx       # Auth state: user, token, login/logout methods
│   └── ThemeContext.tsx      # App theme (light/dark)
│
├── lib/                      # Core utilities and services
│   ├── api-client.ts         # Low-level HTTP client (GET, POST, PUT, DELETE)
│   ├── api.ts                # Domain-specific API calls (authApi, newsApi, etc.)
│   ├── config.ts             # Centralized environment config
│   ├── storage.ts            # Secure token storage (expo-secure-store)
│   └── api-examples.ts       # Usage examples for the API client
│
├── theme/
│   └── colors.ts             # Color palette constants
│
├── assets/                   # Images, icons, splash screen
├── app.json                  # Expo config (name, bundle ID, SDK version)
├── babel.config.js           # Babel config with expo preset
└── tsconfig.json             # TypeScript config
```

---

## Routing — Expo Router & the `app/(tabs)` Structure

This app uses [Expo Router v6](https://docs.expo.dev/router/introduction/), which maps the file system directly to routes — the same convention as Next.js.

### How it works

Every file inside `app/` becomes a route. The filename becomes the URL path segment.

| File | Route |
|------|-------|
| `app/(tabs)/index.tsx` | `/` (Home) |
| `app/(tabs)/portfolio.tsx` | `/portfolio` |
| `app/(tabs)/settings.tsx` | `/settings` |
| `app/(tabs)/news/index.tsx` | `/news` |
| `app/(tabs)/news/[id].tsx` | `/news/123` |
| `app/auth/login.tsx` | `/auth/login` |
| `app/auth/register.tsx` | `/auth/register` |

### Groups: `(tabs)`

The parentheses `(tabs)` create a **route group** — it organizes screens into a shared layout (the bottom tab bar) without adding `tabs` to the URL. The layout for this group is defined in `app/(tabs)/_layout.tsx`.

### Layouts: `_layout.tsx`

Any `_layout.tsx` file wraps all sibling and child routes. The nesting follows the folder structure:

```
app/_layout.tsx             ← wraps everything (root providers)
  └── app/(tabs)/_layout.tsx   ← wraps all tab screens (tab bar)
        └── app/(tabs)/news/_layout.tsx   ← wraps news screens (stack header)
```

### Dynamic routes: `[id].tsx`

Square brackets create dynamic segments. In `app/(tabs)/news/[id].tsx`, the `id` parameter is accessed like this:

```typescript
import { useLocalSearchParams } from 'expo-router';

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // fetch article by id...
}
```

### Navigating between screens

```typescript
import { router } from 'expo-router';

// Navigate to a route
router.push('/news/123');

// Replace current screen (no back button)
router.replace('/auth/login');

// Go back
router.back();
```

### Protected routes

Screens that require authentication use the `ProtectedRoute` component from `components/ProtectedRoute.tsx`. It reads from `AuthContext` and redirects to `/auth/login` if no session exists.

---

## Environment Configuration

All environment config is centralized in `lib/config.ts`. It resolves values in this priority order:

1. `EXPO_PUBLIC_*` environment variables (highest priority)
2. `app.json` → `expo.extra` values
3. Hardcoded fallback defaults

```typescript
// lib/config.ts — what each field controls
config.api.baseUrl      // Backend URL (default: http://localhost:3000)
config.api.timeout      // Request timeout in ms (default: 30000)
config.app.variant      // 'development' | 'production'
config.isDevelopment    // true when variant === 'development'
config.isProduction     // true when variant === 'production'
```

The `app.json` `extra` block holds the defaults used when no `.env` file is present:

```json
"extra": {
  "backendUrl": "http://localhost:3000",
  "environment": "development"
}
```

---

## Running Against Local Backend vs Production

### Against the local backend (default)

Make sure the backend is running first:

```bash
# From the repo root
cd apps/backend
pnpm install
pnpm start:dev   # NestJS starts on port 3000
```

Your `apps/mobile/.env` should have:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_APP_VARIANT=development
```

> **Android emulator note:** `localhost` inside an Android emulator refers to the emulator itself, not your machine. Use `10.0.2.2` instead:
> ```bash
> EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
> ```

> **Physical device note:** Use your machine's local IP address (e.g., `http://192.168.1.x:3000`). Find it with `ifconfig` (macOS/Linux) or `ipconfig` (Windows).

### Against production

```bash
EXPO_PUBLIC_API_URL=https://api.lumenpulse.io
EXPO_PUBLIC_APP_VARIANT=production
```

With these values set, `config.isProduction` will be `true` and `config.isDevelopment` will be `false`, which can be used to conditionally show dev-only UI.

---

## Styling

The app uses **React Native's built-in `StyleSheet` API** with a custom dark-themed design system. There is no NativeWind/Tailwind at this time.

### Color palette

All colors are defined in `theme/colors.ts`. Always import from there rather than hardcoding hex values:

```typescript
import { colors } from '@/theme/colors';

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  title: {
    color: colors.text.primary,
  },
});
```

### Path aliases

The `tsconfig.json` configures `@/` as an alias for the project root, so imports look like:

```typescript
import { colors } from '@/theme/colors';
import { apiClient } from '@/lib/api-client';
import { AuthContext } from '@/contexts/AuthContext';
```

---

## Shared Components & Key Utilities

### `components/ProtectedRoute.tsx`

Wrap any screen that requires an authenticated user. It handles the redirect to login automatically:

```typescript
import ProtectedRoute from '@/components/ProtectedRoute';

export default function PortfolioScreen() {
  return (
    <ProtectedRoute>
      {/* screen content */}
    </ProtectedRoute>
  );
}
```

### `lib/api-client.ts` — HTTP Client

Low-level typed HTTP client. All requests automatically attach the auth token from secure storage.

```typescript
import { apiClient } from '@/lib/api-client';

const response = await apiClient.get<User>('/users/me');
if (response.success) {
  console.log(response.data); // typed as User
} else {
  console.error(response.error.message);
}
```

### `lib/api.ts` — Domain API Services

Pre-built methods grouped by domain. Prefer these over calling `apiClient` directly:

```typescript
import { authApi, newsApi, healthApi } from '@/lib/api';

// Auth
await authApi.login({ email, password });
await authApi.register({ email, password });
await authApi.logout();

// News
const articles = await newsApi.getArticles();
const article  = await newsApi.getArticleById('123');

// Health check
const status = await healthApi.check();
```

### `lib/storage.ts` — Secure Storage

Wraps `expo-secure-store` for persisting auth tokens safely. Used internally by `api-client.ts` — you generally won't need to call this directly.

### `contexts/AuthContext.tsx`

Provides `user`, `token`, `isLoading`, `login()`, and `logout()` to the entire component tree. Access it with the `useAuth` hook:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const { user, login, logout, isLoading } = useAuth();
```

---

## Available Scripts

Run these from inside `apps/mobile/`:

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the Metro bundler (Expo dev server) |
| `pnpm android` | Launch on Android emulator |
| `pnpm ios` | Launch on iOS simulator |
| `pnpm web` | Launch in browser |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Run Prettier on all files |
| `pnpm tsc` | TypeScript type-check (no emit) |

---

## Common Issues

**Metro bundler cache problems**

```bash
pnpm start --clear
```

**iOS simulator not opening**

Make sure Xcode is installed and you've opened the simulator at least once manually via `Xcode → Open Developer Tool → Simulator`.

**Android emulator not detected**

Make sure a virtual device is running in Android Studio's Device Manager before running `pnpm android`.

**`localhost` not resolving on Android emulator**

Use `10.0.2.2` instead of `localhost` in `EXPO_PUBLIC_API_URL`. See [Running Against Local Backend](#against-the-local-backend-default).

**Expo SDK version mismatch in Expo Go**

The app targets Expo SDK ~54. If Expo Go shows a version mismatch, either update Expo Go on your device or use the dev client:

```bash
pnpm expo run:android   # builds and installs dev client on emulator
pnpm expo run:ios       # builds and installs dev client on simulator
```

---

*For questions about the backend API, see `apps/backend/README.md`. For the overall architecture, see `document/ARCHITECTURE.md`.*