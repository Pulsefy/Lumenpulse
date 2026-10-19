import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { CATALOGUE_ENTRIES, CATALOGUE_EXEMPT, isCatalogueEnabled } from '../component-catalogue';

const COMPONENTS_DIR = join(__dirname, '..', '..', 'components');

/** Shared components as they exist on disk: every `.tsx` file in components/. */
function componentFiles(): string[] {
  return readdirSync(COMPONENTS_DIR)
    .filter((entry) => entry.endsWith('.tsx'))
    .sort();
}

describe('component catalogue coverage', () => {
  it('has an entry or a documented exemption for every shared component', () => {
    const covered = new Set([
      ...CATALOGUE_ENTRIES.map((entry) => entry.file),
      ...Object.keys(CATALOGUE_EXEMPT),
    ]);

    // This is the tripwire: a new file in components/ without a catalogue
    // entry (or an exemption with a reason) fails here.
    expect(componentFiles().filter((file) => !covered.has(file))).toEqual([]);
  });

  it('only names files that exist in components/', () => {
    const onDisk = new Set(componentFiles());
    const named = [
      ...CATALOGUE_ENTRIES.map((entry) => entry.file),
      ...Object.keys(CATALOGUE_EXEMPT),
    ];

    expect(named.filter((file) => !onDisk.has(file))).toEqual([]);
  });

  it('never both catalogues and exempts the same component', () => {
    const exempt = new Set(Object.keys(CATALOGUE_EXEMPT));

    expect(CATALOGUE_ENTRIES.filter((entry) => exempt.has(entry.file))).toEqual([]);
  });

  it('lists each component once', () => {
    const files = CATALOGUE_ENTRIES.map((entry) => entry.file);
    const names = CATALOGUE_ENTRIES.map((entry) => entry.name);

    expect(new Set(files).size).toBe(files.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every exemption a reason', () => {
    for (const [file, reason] of Object.entries(CATALOGUE_EXEMPT)) {
      expect({ file, hasReason: reason.trim().length > 0 }).toEqual({ file, hasReason: true });
    }
  });
});

describe('component catalogue variants', () => {
  it('gives every entry at least one variant, without repeats', () => {
    for (const entry of CATALOGUE_ENTRIES) {
      expect(entry.variants.length).toBeGreaterThan(0);
      expect(new Set(entry.variants).size).toBe(entry.variants.length);
    }
  });

  it('shows StandardList loading, empty, error and populated', () => {
    const standardList = CATALOGUE_ENTRIES.find((entry) => entry.name === 'StandardList');

    expect(standardList?.variants).toEqual(['loading', 'empty', 'error', 'populated']);
  });

  it('covers the shared list primitives, the network badge, the modals and the guards', () => {
    const names = CATALOGUE_ENTRIES.map((entry) => entry.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'StandardList',
        'ListSkeleton',
        'ListError',
        'NetworkBadge',
        'ContributionModal',
        'ReportContentModal',
        'ProtectedRoute',
        'BiometricLockGuard',
      ]),
    );
  });
});

describe('isCatalogueEnabled', () => {
  afterEach(() => {
    globalThis.__DEV__ = true;
  });

  it('is off outside development builds', () => {
    expect(isCatalogueEnabled(false)).toBe(false);
  });

  it('is on in a development build running in dev mode', () => {
    expect(isCatalogueEnabled(true)).toBe(true);
  });

  it('stays off in a production bundle even with the development variant', () => {
    globalThis.__DEV__ = false;

    expect(isCatalogueEnabled(true)).toBe(false);
  });
});
