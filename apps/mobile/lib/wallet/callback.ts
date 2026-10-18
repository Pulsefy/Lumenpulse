/** Deep-link path SEP-0007 wallets call back on (see `Sep7WalletAdapter`). */
export const WALLET_CALLBACK_PATH = 'wallet-callback';

/** Fields a SEP-0007 wallet sends back on the `wallet-callback` link. */
export interface WalletCallback {
  status?: string;
  txHash?: string;
  pubkey?: string;
}

/** Signing outcome carried by a callback; `unknown` covers a missing status. */
export type WalletCallbackSigningOutcome =
  | { status: 'success'; txHash: string }
  | { status: 'rejected' }
  | { status: 'failed' }
  | { status: 'unknown' };

/** Minimal shape of `Linking.parse()` output that the callback needs. */
export interface ParsedCallbackUrl {
  path: string | null;
  queryParams?: Record<string, unknown> | null;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * Read a parsed deep link as a wallet callback.
 *
 * Returns null when the link is not the wallet callback. A query parameter
 * repeated in the URL keeps its first value.
 */
export function parseWalletCallback(parsed: ParsedCallbackUrl): WalletCallback | null {
  if (parsed.path !== WALLET_CALLBACK_PATH) return null;

  const params = parsed.queryParams ?? {};
  return {
    status: firstString(params.status),
    txHash: firstString(params.tx_hash),
    pubkey: firstString(params.pubkey),
  };
}

/**
 * Map a callback to the result of the signing request it answers. A success
 * without a transaction hash is not trusted and reads as `unknown`.
 */
export function signingOutcomeFromCallback(callback: WalletCallback): WalletCallbackSigningOutcome {
  if (callback.status === 'success' && callback.txHash) {
    return { status: 'success', txHash: callback.txHash };
  }
  if (callback.status === 'rejected') return { status: 'rejected' };
  if (callback.status === 'failed') return { status: 'failed' };
  return { status: 'unknown' };
}
