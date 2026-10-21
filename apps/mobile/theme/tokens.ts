/**
 * Lumenpulse mobile design tokens.
 *
 * Single source of truth for colour, spacing, radius and typography on mobile.
 * Values are reconciled against the webapp (apps/webapp/app/globals.css and
 * tailwind.config.ts); every deliberate difference is listed in
 * docs/mobile-theme-tokens.md. Components must read colours from
 * `useTheme().colors` (or the theme-independent `palette` / `dataViz` exports
 * below) rather than writing hex or rgba literals - this is enforced by
 * lib/__tests__/theme-literals.test.ts.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Raw brand and neutral primitives. These are not theme-aware; semantic
 * tokens below pick from them per mode. Neutrals are the Tailwind zinc/slate
 * ramps the webapp's shadcn variables resolve to.
 */
export const palette = {
  white: '#ffffff',
  black: '#000000',

  // Brand - identical to the webapp's --surface-button-gradient-default-{a,b,c}
  brandPink: '#db74cf',
  brandPurple: '#9f56ff',
  brandBlue: '#7a85ff',
  // Darkened brand shades so text/icons reach WCAG AA on light surfaces
  brandPinkDeep: '#a8409c',
  brandBlueDeep: '#4f5ad6',

  zinc50: '#fafafa',
  zinc100: '#f4f4f5',
  zinc200: '#e4e4e7',
  zinc400: '#a1a1aa',
  zinc500: '#71717a',
  zinc800: '#27272a',
  zinc900: '#18181b',
  zinc950: '#09090b',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate800: '#1e293b',

  red400: '#f87171',
  red500: '#ef4444',
  red700: '#b91c1c',
  amber500: '#f59e0b',
  amber700: '#b45309',
  green500: '#22c55e',
  green700: '#15803d',
  emerald500: '#10b981',
  blue500: '#3b82f6',
  violet500: '#8b5cf6',
} as const;

/**
 * Categorical colours for charts and badges (asset allocation, contributor
 * tiers, verification states). Theme-independent by design: a category keeps
 * its colour in both modes so legends stay recognisable.
 */
export const dataViz = {
  series: ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b', '#a29bfe', '#fd79a8', '#00b894'],
  tier: {
    core: palette.violet500,
    architect: palette.blue500,
    builder: palette.emerald500,
    novice: palette.amber500,
  },
  status: {
    verified: palette.emerald500,
    pending: palette.amber500,
    rejected: palette.red500,
    archived: palette.slate500,
    unregistered: palette.slate400,
    finalized: palette.violet500,
  },
  /** Leaderboard medals (gold / silver / bronze). */
  rank: [palette.amber500, palette.zinc400, palette.amber700],
} as const;

export interface ThemeColors {
  /** App/screen background. */
  background: string;
  /** Raised surfaces: sections, sheets, headers. */
  surface: string;
  /** Muted fill for inputs, chips and skeletons. */
  surfaceMuted: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  /** Brand tint for text, icons and borders on `background`/`surface`. */
  accent: string;
  accentSecondary: string;
  /** Foreground for content placed on an `accent` fill. */
  onAccent: string;
  /** Translucent accent for selected/pressed backgrounds. */
  accentMuted: string;
  border: string;
  danger: string;
  dangerMuted: string;
  warning: string;
  warningMuted: string;
  success: string;
  successMuted: string;
  info: string;
  /** Foreground for content on a danger/success/warning fill. */
  onStatus: string;
  /** Scrim behind modals and sheets. */
  overlay: string;
  shadow: string;
  /** Switch knob; white in both modes to match native platform controls. */
  switchThumb: string;
  tabBar: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  statusBarStyle: 'light' | 'dark';
}

export const darkColors: ThemeColors = {
  background: palette.zinc950,
  surface: palette.zinc900,
  surfaceMuted: palette.zinc800,
  card: 'rgba(255, 255, 255, 0.05)',
  cardBorder: 'rgba(219, 116, 207, 0.2)',
  text: palette.zinc50,
  textSecondary: palette.zinc400,
  accent: palette.brandPink,
  accentSecondary: palette.brandBlue,
  onAccent: palette.zinc950,
  accentMuted: 'rgba(219, 116, 207, 0.15)',
  border: 'rgba(255, 255, 255, 0.1)',
  danger: palette.red400,
  dangerMuted: 'rgba(248, 113, 113, 0.15)',
  warning: palette.amber500,
  warningMuted: 'rgba(245, 158, 11, 0.15)',
  success: palette.green500,
  successMuted: 'rgba(34, 197, 94, 0.15)',
  info: palette.brandBlue,
  onStatus: palette.zinc950,
  overlay: 'rgba(0, 0, 0, 0.7)',
  shadow: palette.black,
  switchThumb: palette.white,
  tabBar: palette.zinc950,
  tabBarBorder: 'rgba(219, 116, 207, 0.2)',
  tabBarActive: palette.brandPink,
  tabBarInactive: palette.zinc400,
  statusBarStyle: 'light',
};

export const lightColors: ThemeColors = {
  background: '#f8f6fa',
  surface: palette.white,
  surfaceMuted: palette.zinc100,
  card: 'rgba(219, 116, 207, 0.06)',
  cardBorder: 'rgba(168, 64, 156, 0.18)',
  text: palette.zinc950,
  textSecondary: palette.zinc500,
  accent: palette.brandPinkDeep,
  accentSecondary: palette.brandBlueDeep,
  onAccent: palette.white,
  accentMuted: 'rgba(168, 64, 156, 0.12)',
  border: palette.zinc200,
  danger: palette.red700,
  dangerMuted: 'rgba(185, 28, 28, 0.1)',
  warning: palette.amber700,
  warningMuted: 'rgba(180, 83, 9, 0.1)',
  success: palette.green700,
  successMuted: 'rgba(21, 128, 61, 0.1)',
  info: palette.brandBlueDeep,
  onStatus: palette.white,
  overlay: 'rgba(9, 9, 11, 0.5)',
  shadow: palette.black,
  switchThumb: palette.white,
  tabBar: palette.white,
  tabBarBorder: palette.zinc200,
  tabBarActive: palette.brandPinkDeep,
  tabBarInactive: palette.zinc500,
  statusBarStyle: 'dark',
};

export const themes: Record<ResolvedTheme, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

/** 4pt spacing scale (matches Tailwind's 1 = 4px used by the webapp). */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Webapp --radius is 0.5rem (8px); md/lg mirror its calc() steps. */
export const radius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  pill: 999,
} as const;

export const typography = {
  fontFamily: {
    // System fonts on device. The webapp loads Inter/Orbitron/Space Mono/
    // Chakra Petch; bundling them here would count against the mobile size
    // budget (issue #1413), so this is a deliberate difference.
    regular: undefined as string | undefined,
    mono: 'Courier',
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 32,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
  },
} as const;

export const tokens = { palette, dataViz, spacing, radius, typography, themes } as const;
