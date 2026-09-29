import { describe, expect, it } from 'vitest';
import {
  hrefForAsset,
  hrefForEcosystem,
  hrefForProject,
} from './search-api';

describe('search-api href helpers', () => {
  it('builds project detail hrefs', () => {
    expect(hrefForProject(42)).toBe('/projects/42');
  });

  it('builds asset detail hrefs with issuer', () => {
    expect(hrefForAsset('USDC', 'GABC')).toBe('/assets/USDC?issuer=GABC');
  });

  it('builds ecosystem news hrefs', () => {
    expect(hrefForEcosystem('tag', 'stellar')).toBe('/news?tag=stellar');
    expect(hrefForEcosystem('category', 'DeFi')).toBe('/news?category=DeFi');
  });
});
