import { WalletError } from './errors';

/**
 * Lifecycle states for a signing request.
 *
 * Kept separate from the connection lifecycle so screens can show
 * "Connected" while the wallet is actively signing a transaction.
 */
export type WalletSigningState = 'idle' | 'signing' | 'pending' | 'success' | 'rejected' | 'failed';

/**
 * Result returned by a signing attempt.
 *
 * `pending` is used by deep-link adapters: the wallet app has been opened
 * and the final result will arrive asynchronously via the app's URL handler.
 */
export interface WalletSigningResult {
  status: 'success' | 'rejected' | 'failed' | 'pending';
  txHash?: string;
  error?: WalletError;
}

/**
 * Result returned by a connection attempt.
 */
export interface WalletConnectionResult {
  status: 'connected' | 'rejected' | 'failed';
  pubkey?: string;
}

/**
 * Abstraction over a Stellar-compatible mobile wallet.
 *
 * New providers can be added by implementing this interface and registering
 * the adapter in `registry.ts`.
 */
export interface WalletAdapter {
  readonly id: string;
  readonly name: string;

  /**
   * True if the current device/runtime can use this adapter.
   * For example, SEP-0007 adapters check whether a wallet app handles
   * `web+stellar:` links.
   */
  isAvailable(): Promise<boolean> | boolean;

  /**
   * Initiate a wallet connection and return the public key when possible.
   *
   * Deep-link-based adapters may return `{ status: 'connected' }` without a
   * public key because the user completes authorization in the wallet app and
   * the host app receives the pubkey asynchronously.
   */
  connect(): Promise<WalletConnectionResult>;

  /**
   * Request a signature for a base64-encoded Stellar transaction envelope.
   *
   * Deep-link-based adapters return the result asynchronously via the app's
   * URL handler. The context layer correlates the callback with the pending
   * signing promise.
   */
  signXdr(xdr: string): Promise<WalletSigningResult>;
}
