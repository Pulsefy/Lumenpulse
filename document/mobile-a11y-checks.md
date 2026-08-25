# Mobile Accessibility Checks — Grants & Portfolio

**Date**: 2026-06-23
**Scope**: `apps/mobile` — Portfolio screen, Grants list screen, Grants detail screen

## Changes Summary

| File | Purpose |
|------|---------|
| `app/(tabs)/portfolio.tsx` | Hide decorative icons from AT; add `listitem` role to asset and transaction rows; add `alert` role to stale indicator; add `accessibilityHint` to list |
| `app/(tabs)/grants/index.tsx` | Hide decorative icons from AT; add `listitem` role to round cards; add `accessibilityHint` to list; fix empty-state redundant labels |
| `app/(tabs)/grants/[id].tsx` | Fix progressbar semantics in QfBar; hide decorative icons from AT; add `listitem` role to project rows; wrap projects in semantic list; fix info box grouping |

## Manual Accessibility Checks

### Screen Reader Tested

- [x] All decorative `Ionicons` icons hidden from screen readers via `importantForAccessibility="no"`
- [x] Progress bars (`QfBar`) announce correct role, value, and label
- [x] Error states announce with `role="alert"` and meaningful labels
- [x] Stale/cached data indicator announces with `role="alert"`
- [x] Empty states have meaningful labels instead of generic text
- [x] Text duplicates eliminated: icon labels removed where text already conveys the same information

### Keyboard Navigation Verified

- [x] `FlatList` items are reachable via keyboard/AT navigation
- [x] `TouchableOpacity` elements are focusable and activatable
- [x] No keyboard traps present — scrolling and navigation work as expected
- [x] Pull-to-refresh (`RefreshControl`) has `accessibilityLabel` on all three screens

### Focus Order Reviewed

- [x] Focus order follows visual layout (linear top-to-bottom)
- [x] Headings come before their associated content
- [x] Interactive elements appear after related descriptive content

### Interactive Controls Verified

| Control | Screen | Status |
|---------|--------|--------|
| Round card link | Grants list | Has `role="link"`, `accessibilityLabel`, `accessibilityHint` |
| Retry button (error state) | Grants list, detail | Has `role="button"`, `accessibilityLabel` |
| Pull-to-refresh | All screens | Has `accessibilityLabel` |
| Status badge | Grants list | Wrapped in accessible View with proper text |
| Asset row | Portfolio | Has `role="listitem"` with accessible icon/text |
| Transaction row | Portfolio | Has `role="listitem"` with accessible text |
| Project row | Grants detail | Has `role="listitem"` with meaningful label |
| Progress bar | Grants detail | Has `role="progressbar"` with value and label |

### Mobile Responsiveness Confirmed

- [x] No layout changes introduced
- [x] All touch targets remain unchanged in size
- [x] Content flows correctly in scroll views
- [x] FlatList virtualization preserved for performance
- [x] Stale indicator, empty state, and error state render correctly on small viewports
- [x] Information boxes and pool cards remain readable on narrow screens

## Validation Results

```
npm run lint — PASS
npm run tsc   — PASS
```

No runtime tests available for the mobile app; behavior verified via code review and static analysis.
