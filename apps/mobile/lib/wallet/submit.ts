import { AppEnvironment, getActiveEnvironment, getEnvironmentConfig } from '../config';
import { WalletError } from './errors';
import { WalletSigningResult } from './types';

/** Network passphrases of the two environments the app can target. */
export const NETWORK_PASSPHRASES: Record<AppEnvironment, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
};

export function getNetworkPassphrase(environment: AppEnvironment = getActiveEnvironment()): string {
  return NETWORK_PASSPHRASES[environment];
}

interface SendTransactionResponse {
  result?: { status?: string; hash?: string };
  error?: { message?: string };
}

/**
 * Submit a signed transaction envelope with the Soroban RPC `sendTransaction`
 * method and return its hash.
 *
 * Mobile callers expect a transaction hash from every adapter, because the
 * SEP-0007 wallet submits the transaction itself. Adapters that only sign
 * (xBull) use this so they behave the same way. `PENDING` and `DUPLICATE`
 * mean the network accepted the envelope; any other answer is a failure.
 * The signed envelope is kept on the result either way.
 */
export async function submitSignedXdr(
  signedXdr: string,
  rpcUrl: string = getEnvironmentConfig().sorobanRpcUrl,
): Promise<WalletSigningResult> {
  if (!rpcUrl) {
    return {
      status: 'failed',
      signedXdr,
      error: new WalletError('not_available', 'No Soroban RPC URL is configured for this network.'),
    };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: { transaction: signedXdr },
      }),
    });
    const body = (await response.json()) as SendTransactionResponse;
    const status = body.result?.status;
    const hash = body.result?.hash;

    if ((status === 'PENDING' || status === 'DUPLICATE') && hash) {
      return { status: 'success', signedXdr, txHash: hash };
    }

    const detail =
      body.error?.message ??
      (status
        ? `Transaction submission returned ${status}.`
        : `Transaction submission failed (HTTP ${response.status}).`);
    return { status: 'failed', signedXdr, error: new WalletError('unknown', detail) };
  } catch (error) {
    return {
      status: 'failed',
      signedXdr,
      error: new WalletError(
        'unknown',
        'Could not reach the Soroban RPC to submit the transaction.',
        error,
      ),
    };
  }
}
