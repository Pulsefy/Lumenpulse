import { sanitizePublicKey } from '../storage';

/**
 * Helpers
 */
const VALID_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ALMOST_VALID_KEY_TOO_SHORT = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALMOST_VALID_KEY_WITH_INVALID_CHAR = 'G' + 'O'.repeat(55);

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
};

/**
 * sanitizePublicKey rejects keys that don't fit the Stellar stride/format
 * (G prefix + 55 base32 chars from [A-Z2-7]).
 */
export function testSanitizePublicKeyAcceptsValidFormat(): boolean {
  try {
    assert(sanitizePublicKey(VALID_KEY) === VALID_KEY, 'expected validation pass for canonical G key');
    assert(sanitizePublicKey('G' + 'ABCDE234567'.repeat(5) + 'AA') !== null, 'expected base32 to pass');
    return true;
  } catch (error) {
    console.error('✗ testSanitizePublicKeyAcceptsValidFormat:', error);
    return false;
  }
}

export function testSanitizePublicKeyRejectsInvalidFormats(): boolean {
  try {
    assert(sanitizePublicKey(null) === null, 'null in -> null out');
    assert(sanitizePublicKey(undefined) === null, 'undefined in -> null out');
    assert(sanitizePublicKey('') === null, 'empty string rejected');
    assert(sanitizePublicKey('not-a-key') === null, 'arbitrary string rejected');
    assert(sanitizePublicKey(ALMOST_VALID_KEY_TOO_SHORT) === null, 'wrong length rejected');
    assert(sanitizePublicKey(ALMOST_VALID_KEY_WITH_INVALID_CHAR) === null, 'invalid base32 char rejected');
    // Lowercase characters are not in the base32 alphabet and must be rejected.
    assert(sanitizePublicKey('g' + 'A'.repeat(55)) === null, 'lowercase g prefix rejected');
    return true;
  } catch (error) {
    console.error('✗ testSanitizePublicKeyRejectsInvalidFormats:', error);
    return false;
  }
}

/**
 * Stale session metadata is treated as having no usable public key.
 */
export function testStaleMetadataClearsOnInvalidKey(): boolean {
  try {
    // Simulate what parseWalletMetadata would do for a saved session with
    // an invalid pointer (this is the storage-level guarantee we depend on
    // for the network-aware reconnect flow).
    const staleKey: unknown = ALMOST_VALID_KEY_WITH_INVALID_CHAR;
    assert(sanitizePublicKey(staleKey) === null, 'stale key must be cleared by sanitizer');
    return true;
  } catch (error) {
    console.error('✗ testStaleMetadataClearsOnInvalidKey:', error);
    return false;
  }
}

export function runWalletStorageTests(): boolean {
  console.log('=== Wallet Storage Tests ===\n');

  console.log('1. Accepting canonical Stellar public keys...');
  const t1 = testSanitizePublicKeyAcceptsValidFormat();
  console.log(t1 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('2. Rejecting invalid Stellar public keys...');
  const t2 = testSanitizePublicKeyRejectsInvalidFormats();
  console.log(t2 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('3. Stale session safety: invalid keys resolve to null...');
  const t3 = testStaleMetadataClearsOnInvalidKey();
  console.log(t3 ? '✓ PASS\n' : '✗ FAIL\n');

  const allPassed = t1 && t2 && t3;
  console.log(
    allPassed
      ? '=== ALL WALLET STORAGE TESTS PASSED ==='
      : '=== SOME WALLET STORAGE TESTS FAILED ===',
  );
  return allPassed;
}
