import { config } from './config';

/**
 * Component catalogue: the list behind the development-only screen at
 * `app/dev/catalogue.tsx`, which renders each shared component in
 * `components/` in its states.
 *
 * Every `.tsx` file in `components/` must appear here, either as an entry or
 * as an exemption with a reason. `lib/__tests__/component-catalogue.test.ts`
 * fails when a new shared component has neither.
 */

/** States the catalogue can show for a component. */
export type CatalogueVariant = 'default' | 'loading' | 'empty' | 'error' | 'populated';

export interface CatalogueEntry {
  /** Name the component is imported by. */
  name: string;
  /** File name under `components/`. */
  file: string;
  /** States rendered on the catalogue screen, in display order. */
  variants: readonly CatalogueVariant[];
  /** What the component is for, shown above its previews. */
  description: string;
}

export const CATALOGUE_ENTRIES: readonly CatalogueEntry[] = [
  {
    name: 'StandardList',
    file: 'StandardList.tsx',
    variants: ['loading', 'empty', 'error', 'populated'],
    description: 'Virtualized list used by the news, projects, grants and history screens.',
  },
  {
    name: 'ListSkeleton',
    file: 'ListSkeleton.tsx',
    variants: ['loading'],
    description: 'Placeholder rows shown while a list loads.',
  },
  {
    name: 'ListError',
    file: 'ListError.tsx',
    variants: ['error'],
    description: 'Error message for a list, with an optional retry action.',
  },
  {
    name: 'NetworkBadge',
    file: 'NetworkBadge.tsx',
    variants: ['default'],
    description: 'Badge naming the active Stellar network (testnet or mainnet).',
  },
  {
    name: 'CachedImage',
    file: 'CachedImage.tsx',
    variants: ['empty'],
    description: 'Remote image backed by the image cache; reserves its size with a placeholder.',
  },
  {
    name: 'ContributionModal',
    file: 'ContributionModal.tsx',
    variants: ['default'],
    description: 'Modal to contribute to a project. The preview submit handler sends nothing.',
  },
  {
    name: 'ReportContentModal',
    file: 'ReportContentModal.tsx',
    variants: ['default'],
    description: 'Modal to report content to moderators. Submitting it sends a real report.',
  },
  {
    name: 'ProtectedRoute',
    file: 'ProtectedRoute.tsx',
    variants: ['populated'],
    description: 'Guard that renders its children when signed in and redirects to login if not.',
  },
  {
    name: 'BiometricLockGuard',
    file: 'BiometricLockGuard.tsx',
    variants: ['populated'],
    description: 'Guard that locks the app behind biometrics when the lock is enabled in Settings.',
  },
];

/**
 * Components left out of the catalogue on purpose, keyed by file name, with
 * the reason. Prefer adding an entry; exempt only what cannot be previewed in
 * isolation.
 */
export const CATALOGUE_EXEMPT: Readonly<Record<string, string>> = {
  'DataPreloader.tsx': 'Renders nothing; it warms caches when the app starts.',
  'Header.tsx': 'HeaderBell loads /notifications from the API as soon as it mounts.',
  'PortfolioAnalyticsChart.tsx':
    'Loads wallet analytics from the API; its states are unit tested in lib/analytics.ts.',
  'StartupInteractiveGate.tsx':
    'Wraps the root layout to record time to interactive; renders only a zero size sentinel.',
  'VerificationPanel.tsx':
    'Bound to the verification API for one project; it is shown on the project detail screen.',
};

/**
 * The catalogue is reachable in development builds only: the same check as
 * the mock wallet adapter in `lib/wallet/registry.ts`.
 */
export function isCatalogueEnabled(isDevelopment: boolean = config.isDevelopment): boolean {
  return isDevelopment && (typeof __DEV__ === 'undefined' || __DEV__);
}
