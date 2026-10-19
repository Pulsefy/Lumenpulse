import { xdr } from '@stellar/stellar-sdk';

/** Decode only real Stellar transaction result codes, keeping metric labels bounded. */
export function extractTransactionResultCode(value: unknown): string {
  try {
    const result =
      typeof value === 'string'
        ? xdr.TransactionResult.fromXDR(value, 'base64')
        : value;
    if (!(result instanceof xdr.TransactionResult)) return 'unknown';
    return result
      .result()
      .switch()
      .name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  } catch {
    return 'unknown';
  }
}
