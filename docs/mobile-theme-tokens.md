# Mobile theme tokens

Mobile colours, spacing, radius and typography come from one file:
[`apps/mobile/theme/tokens.ts`](../apps/mobile/theme/tokens.ts). This page records how those
values line up with the webapp ([`apps/webapp/app/globals.css`](../apps/webapp/app/globals.css),
[`tailwind.config.ts`](../apps/webapp/tailwind.config.ts)) and why each difference exists.

## Using tokens

```tsx
import { useTheme } from '../contexts/ThemeContext'; // or useLocalization() from src/context
import { spacing, radius, typography, dataViz } from '../theme/tokens';

const { colors } = useTheme();
<View style={{ backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.lg }}>
  <Text style={{ color: colors.text, fontSize: typography.size.md }}>…</Text>
</View>
```

- Read colours from `colors` for anything that should change with the theme.
- For category colours that must look the same in both themes (chart series,
  contributor tiers, verification badges), use `dataViz`.
- Put text on an accent fill in `colors.onAccent`, and text on a
  danger/warning/success fill in `colors.onStatus`. Don't use white directly.
- Don't write hex or `rgb()`/`rgba()` literals in components.
  `lib/__tests__/theme-literals.test.ts` fails CI if one appears outside `theme/`.
  If you need a colour that has no token, add the token instead.

## Modes and persistence

| | Webapp | Mobile |
|---|---|---|
| Preferences | `light`, `dark`, `system` | same |
| Default | `system` | same |
| Fallback when the OS reports nothing | `light` | same (`resolveTheme` in `lib/theme-preference.ts`) |
| Storage | `localStorage['lumenpulse-theme-preference']` | `AsyncStorage['@theme_mode']` (kept from the old `ThemeContext` so existing user choices carry over) |
| Invalid stored value | cleared, default used | same |
| System changes | `matchMedia` listener | `useColorScheme()` re-renders live |

The picker is in **Settings › Appearance**. It now highlights the stored
preference, so **System** shows as selected while it is active. Before this
change it highlighted the resolved theme, and **System** never appeared
selected.

Before this change mobile had two providers with two different palettes:
`contexts/ThemeContext.tsx`, which used a blue accent and iOS greys, and
`src/context`, which used the brand pink. Screens showed whichever one they
happened to import, and the in-app picker only changed one of them.
`ThemeContext` now re-exports `useTheme` from `src/context`, so every screen
reads the same state.

## Reconciliation with the webapp

### Matching values

| Token | Mobile | Webapp source |
|---|---|---|
| Brand gradient | `palette.brandPink` `#db74cf`, `brandPurple` `#9f56ff`, `brandBlue` `#7a85ff` | `--surface-button-gradient-default-{a,b,c}` |
| Dark background | `#09090b` | `--background: 240 10% 3.9%` |
| Dark text | `#fafafa` | `--foreground: 0 0% 98%` |
| Light text | `#09090b` | light `--foreground` |
| Light secondary text | `#71717a` | light `--muted-foreground: 240 3.8% 46.1%` |
| Light border | `#e4e4e7` | light `--border: 240 5.9% 90%` |
| Light muted fill (`surfaceMuted`) | `#f4f4f5` | light `--muted: 240 4.8% 95.9%` |
| Radius | `radius.lg` 8, `md` 6, `sm` 4 | `--radius: 0.5rem` and its `calc()` steps |
| Spacing | 4pt scale | Tailwind default scale (1 = 4px) |

### Deliberate differences

| Token | Mobile | Webapp | Why |
|---|---|---|---|
| Primary/accent | Brand pink (`#db74cf` dark, `#a8409c` light) | `--primary` is shadcn blue `217 91% 60%` | The webapp's `--primary` is the unmodified shadcn default. Its branded surfaces (buttons, the hero) use the pink→blue gradient. Mobile has always used the brand pink as its accent, so it keeps the brand colour instead of the default. |
| Light-mode accent | `#a8409c` | n/a | `#db74cf` on white is 2.83:1, which fails WCAG AA. `#a8409c` is the same hue at 5.41:1. |
| Text on accent, dark mode (`onAccent`) | `#09090b` | `--text-button-gradient: #ffffff` | White on `#db74cf` is 2.83:1. Near-black reaches 7.02:1. The webapp's white text sits on a gradient that runs into the darker `#9f56ff`. Mobile buttons are a solid pink fill, so they need the dark foreground. |
| Dark danger | `#f87171` | `--destructive: 0 62.8% 30.6%` (`#7f1d1d`) | The webapp uses destructive as a fill behind light text. Mobile uses `danger` mostly for text and icons on a dark background, where `#7f1d1d` would be unreadable. |
| Light danger | `#b91c1c` | `#ef4444` | `#ef4444` on white is 3.76:1. Red-600 reaches only 4.50:1 on the tinted `#f8f6fa` background. Red-700 passes AA on both. |
| Dark secondary text | `#a1a1aa` (zinc) | `215 20% 65%` (`#94a3b8`, slate) | Mobile keeps neutrals on a single zinc ramp. Both reach about 7.8:1 on the background. |
| Light background | `#f8f6fa` | `#ffffff` | The faint brand tint has always been the mobile light background. Surfaces and cards stay white, which matches the webapp's cards. |
| Warning / success | amber/green 500 (dark), 700 (light) | not defined | The webapp has no status tokens. Mobile uses Tailwind ramps tuned to pass 4.5:1. |
| Fonts | System fonts | Inter, Orbitron, Space Mono, Chakra Petch | Bundled fonts would count against the mobile size budget (#1413). |

`lib/__tests__/theme-tokens.test.ts` asserts the matching values above. It also
checks that every text-like token passes WCAG AA (4.5:1) on `background` and
`surface` in both modes, and that `onAccent` and `onStatus` pass AA on their
fills.

## Changing the brand

1. Edit `palette` in `theme/tokens.ts` and the matching
   `--surface-button-gradient-*` variables in `apps/webapp/app/globals.css`.
2. Run `npm test` in `apps/mobile`. The contrast tests show any mode that no
   longer meets AA.
3. Update the tables on this page.
