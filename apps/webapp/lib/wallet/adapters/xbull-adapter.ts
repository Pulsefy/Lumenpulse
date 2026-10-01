import { WalletError, isRejectionMessage, walletErrorMessage } from '../errors';
import {
  WalletAdapter,
  WalletConnectionResult,
  WalletSignOptions,
  WalletSigningResult,
} from '../types';

/**
 * Subset of the API the xBull extension injects as `window.xBullSDK`.
 * See https://github.com/Creit-Tech/xBull-Wallet (xBull SDK docs).
 */
interface XBullSDK {
  connect(permissions: { canRequestPublicKey: boolean; canRequestSign: boolean }): Promise<unknown>;
  getPublicKey(): Promise<string>;
  signXDR(xdr: string, options?: { network?: string; publicKey?: string }): Promise<string>;
}

function getSdk(): XBullSDK | null {
  if (typeof window === 'undefined') return null;
  const sdk = (window as unknown as { xBullSDK?: XBullSDK }).xBullSDK;
  return sdk ?? null;
}

function toFailure(err: unknown, fallback: string) {
  const message = walletErrorMessage(err, fallback);
  return isRejectionMessage(message)
    ? { status: 'rejected' as const, error: new WalletError('rejected', message, err) }
    : { status: 'failed' as const, error: new WalletError('unknown', message, err) };
}

/**
 * xBull browser-extension adapter. Uses the injected SDK, so no extra
 * dependency is bundled.
 */
export class XBullWalletAdapter implements WalletAdapter {
  readonly id = 'xbull';
  readonly name = 'xBull';
  readonly installUrl = 'https://xbull.app';

  isAvailable(): boolean {
    return getSdk() !== null;
  }

  async connect(): Promise<WalletConnectionResult> {
    const sdk = getSdk();
    if (!sdk) {
      return {
        status: 'failed',
        error: new WalletError('missing_wallet', 'xBull extension not found. Install it from xbull.app.'),
      };
    }

    try {
      await sdk.connect({ canRequestPublicKey: true, canRequestSign: true });
      const pubkey = await sdk.getPublicKey();
      if (!pubkey) {
        return {
          status: 'failed',
          error: new WalletError('unknown', 'xBull did not return a public key.'),
        };
      }
      return { status: 'connected', pubkey };
    } catch (err) {
      return toFailure(err, 'Failed to connect xBull');
    }
  }

  async signXdr(xdr: string, options: WalletSignOptions = {}): Promise<WalletSigningResult> {
    const sdk = getSdk();
    if (!sdk) {
      return {
        status: 'failed',
        error: new WalletError('missing_wallet', 'xBull extension not found.'),
      };
    }

    try {
      const signedXdr = await sdk.signXDR(xdr, {
        network: options.networkPassphrase,
        publicKey: options.address,
      });
      return { status: 'success', signedXdr };
    } catch (err) {
      return toFailure(err, 'Signing failed');
    }
  }
}
