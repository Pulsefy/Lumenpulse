/**
 * Wallet error codes surfaced by the adapter layer.
 *
 * These are intentionally coarse-grained: the UI maps each code to a
 * user-friendly message. Callers should avoid parsing error messages.
 */
export type WalletErrorCode =
  | 'not_available'
  | 'missing_wallet'
  | 'unsupported_device'
  | 'rejected'
  | 'unknown';

/**
 * Typed error raised by wallet adapters.
 */
export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}
