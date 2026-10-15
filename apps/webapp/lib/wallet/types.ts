import { WalletError } from './errors';

/**
 * Lifecycle states for a signing request.
 *
 * Same naming as apps/mobile/lib/wallet/types.ts.
 */
export type WalletSigningState = 'idle' | 'signing' | 'pending' | 'success' | 'rejected' | 'failed';

/**
 * Result returned by a signing attempt.
 *
 * Browser wallets return the signed envelope synchronously, so `signedXdr`
 * is set on success. `pending` is kept for parity with the mobile SEP-0007
 * adapter, where the result arrives through a deep-link callback.
 */
export interface WalletSigningResult {
  status: 'success' | 'rejected' | 'failed' | 'pending';
  signedXdr?: string;
  txHash?: string;
  error?: WalletError;
}

/**
 * Result returned by a connection attempt.
 */
export interface WalletConnectionResult {
  status: 'connected' | 'rejected' | 'failed';
  pubkey?: string;
  error?: WalletError;
}

export interface WalletSignOptions {
  networkPassphrase?: string;
  /** Account expected to sign; wallets that support it will use it. */
  address?: string;
}

/**
 * Abstraction over a Stellar-compatible browser wallet.
 *
 * New providers can be added by implementing this interface and registering
 * the adapter in `registry.ts`.
 */
export interface WalletAdapter {
  readonly id: string;
  readonly name: string;
  /** Where users can install the wallet when it is not detected. */
  readonly installUrl?: string;

  /** True if the current browser can use this adapter (extension injected). */
  isAvailable(): Promise<boolean> | boolean;

  /** Request access and return the public key. */
  connect(): Promise<WalletConnectionResult>;

  /**
   * Return the address of an existing session without prompting the user,
   * or null when the wallet is not already authorised for this site.
   */
  getConnectedAddress?(): Promise<string | null>;

  /** Request a signature for a base64-encoded Stellar transaction envelope. */
  signXdr(xdr: string, options?: WalletSignOptions): Promise<WalletSigningResult>;
}
