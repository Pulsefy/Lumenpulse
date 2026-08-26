import { sanitizePublicKey } from '../storage';

describe('sanitizePublicKey', () => {
  const VALID_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const ALMOST_VALID_KEY_TOO_SHORT = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const ALMOST_VALID_KEY_WITH_INVALID_CHAR = 'G' + '1'.repeat(55);

  it('accepts a canonical Stellar public key', () => {
    expect(sanitizePublicKey(VALID_KEY)).toBe(VALID_KEY);
    expect(sanitizePublicKey('G' + 'A'.repeat(55))).not.toBeNull();
  });

  it('rejects malformed or non-canonical keys', () => {
    expect(sanitizePublicKey(null)).toBeNull();
    expect(sanitizePublicKey(undefined)).toBeNull();
    expect(sanitizePublicKey('')).toBeNull();
    expect(sanitizePublicKey('not-a-key')).toBeNull();
    expect(sanitizePublicKey(ALMOST_VALID_KEY_TOO_SHORT)).toBeNull();
    expect(sanitizePublicKey(ALMOST_VALID_KEY_WITH_INVALID_CHAR)).toBeNull();
    expect(sanitizePublicKey('g' + 'A'.repeat(55))).toBeNull();
  });
});
