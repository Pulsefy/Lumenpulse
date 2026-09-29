import { getReleaseMetadata, fallbackReleaseMetadata } from '../release-metadata';

describe('release metadata', () => {
  it('returns release metadata with the required shape', () => {
    const data = getReleaseMetadata();

    expect(data).toBeTruthy();
    expect(Array.isArray(data.releases)).toBe(true);
    expect(data.releases.length).toBeGreaterThan(0);
    expect(typeof data.releases[0].version).toBe('string');
    expect(typeof data.releases[0].title).toBe('string');
    expect(Array.isArray(data.releases[0].notes)).toBe(true);
  });

  it('falls back to the bundled metadata when the asset is unavailable', () => {
    expect(fallbackReleaseMetadata.releases[0].version).toBe('1.0.0');
    expect(Array.isArray(fallbackReleaseMetadata.releases[0].notes)).toBe(true);
    expect(fallbackReleaseMetadata.releases[0].notes.length).toBeGreaterThan(0);
  });
});
