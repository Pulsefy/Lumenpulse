# Installation & Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd apps/mobile
npm install
# or
pnpm install
# or
yarn install
```

### 2. Install Localization Dependencies

```bash
cd apps/mobile
npm install i18next react-i18next expo-localization i18next-resources-to-backend
# or
pnpm add i18next react-i18next expo-localization i18next-resources-to-backend
# or
yarn add i18next react-i18next expo-localization i18next-resources-to-backend
```

### 3. Verify Installation

Check that the following files exist:
- `src/i18n/index.ts`
- `src/context/index.tsx`
- `locales/en/common.json`
- `locales/zh/common.json`

## Using Translations

### In Function Components

```typescript
import { useLocalization } from '../src/context';

const MyComponent = () => {
  const { t, colors, resolvedMode, setThemeMode } = useLocalization();
  
  return (
    <Text>{t('auth.login.title')}</Text>
  );
};
```

### With Parameters

```typescript
t('contribution_modal.success_message', {
  amount: '100',
  project: 'My Project'
})
```

### Adding New Translations

1. Add to `locales/en/common.json`
2. Add to `locales/zh/common.json`
3. Use with `t('new.key')`

## Accessibility Features

All components include:
- `accessibilityLabel` - For screen readers
- `accessibilityHint` - Contextual information
- `accessibilityRole` - Semantic meaning (button, header, etc.)
- `accessibilityState` - Dynamic state (disabled, checked, etc.)

## Development

### Start Dev Server

```bash
cd apps/mobile
npm start
```

### Test on Device

```bash
# iOS
npm run ios

# Android
npm run android

# Web
npm run web
```

## Project Structure

```
apps/mobile/
├── src/
│   ├── i18n/          # i18next configuration
│   └── context/       # Localization + Theme context
├── locales/
│   ├── en/
│   │   └── common.json  # English translations
│   └── zh/
│       └── common.json  # Chinese translations
├── app/               # Expo Router pages
├── components/        # Reusable components
├── contexts/          # React contexts
├── hooks/             # Custom hooks
├── lib/               # Utilities, API clients
└── theme/             # Theme definitions
```

## Troubleshooting

### Missing Translations
If a key is missing, `t()` returns the key itself (e.g., "missing.key").

### TypeScript Errors
Run `npm run tsc` to check types.

### Formatting
Run `npm run format` to auto-format with Prettier.

### Linting
Run `npm run lint` to check with ESLint.
