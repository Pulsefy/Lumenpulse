import { darkColors, lightColors, themes, spacing, radius, palette } from '../../theme/tokens';

// WCAG 2.1 relative luminance / contrast ratio for opaque hex colours.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

describe('theme tokens', () => {
  it('defines the same semantic keys in light and dark', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
    expect(themes.light).toBe(lightColors);
    expect(themes.dark).toBe(darkColors);
  });

  it('keeps the brand colours shared with the webapp gradient', () => {
    // apps/webapp/app/globals.css --surface-button-gradient-default-{a,b,c}
    expect(palette.brandPink).toBe('#db74cf');
    expect(palette.brandPurple).toBe('#9f56ff');
    expect(palette.brandBlue).toBe('#7a85ff');
    expect(darkColors.accent).toBe(palette.brandPink);
  });

  it('matches the webapp neutrals for background and foreground', () => {
    // --background / --foreground in dark (240 10% 3.9% / 0 0% 98%)
    expect(darkColors.background).toBe('#09090b');
    expect(darkColors.text).toBe('#fafafa');
    // light foreground (240 10% 3.9%) and border (240 5.9% 90%)
    expect(lightColors.text).toBe('#09090b');
    expect(lightColors.border).toBe('#e4e4e7');
  });

  describe.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('%s mode contrast', (_name, c) => {
    it.each(['text', 'textSecondary', 'accent', 'accentSecondary', 'danger', 'warning', 'success'] as const)(
      '%s meets WCAG AA on background and surface',
      (key) => {
        expect(contrast(c[key], c.background)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(c[key], c.surface)).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );

    it('onAccent meets WCAG AA on both accent fills', () => {
      expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(c.onAccent, c.accentSecondary)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(['danger', 'warning', 'success'] as const)('onStatus meets WCAG AA on %s', (key) => {
      expect(contrast(c.onStatus, c[key])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('status bar style matches the background brightness', () => {
      expect(c.statusBarStyle).toBe(luminance(c.background) > 0.5 ? 'dark' : 'light');
    });
  });

  it('uses a 4pt spacing scale and the webapp 8px base radius', () => {
    Object.values(spacing).forEach((v) => expect(v % 2).toBe(0));
    expect(radius.lg).toBe(8);
  });
});
