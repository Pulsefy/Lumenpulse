/**
 * Wallet error codes surfaced by the adapter layer.
 *
 * Mirrors apps/mobile/lib/wallet/errors.ts so the two registries stay
 * comparable. The UI maps each code to a user-friendly message; callers
 * should avoid parsing error messages.
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

/** Normalise the many error shapes browser wallets return into a string. */
export function walletErrorMessage(error: unknown, fallback = 'Unknown wallet error'): string {
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** Heuristic used by browser wallets that report user rejection as free text. */
export function isRejectionMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('user') ||
    lower.includes('denied') ||
    lower.includes('reject') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  );
}
