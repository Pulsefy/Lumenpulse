import { StrKey } from '@stellar/stellar-sdk';
import { InvalidPublicKeyException } from '../exceptions/stellar.exceptions';

/**
 * Validates a Stellar public key format
 * @param publicKey - The public key to validate
 * @throws InvalidPublicKeyException if the public key is invalid
 */
export function validateStellarPublicKey(publicKey: string): void {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new InvalidPublicKeyException(publicKey || 'undefined');
  }

  // Stellar public keys are Ed25519 public keys, base32 encoded, starting with 'G'
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new InvalidPublicKeyException(publicKey);
  }
}
