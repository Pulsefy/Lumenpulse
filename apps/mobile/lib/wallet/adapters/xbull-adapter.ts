import { Platform } from 'react-native';
import { WalletError, isRejectionMessage, walletErrorMessage } from '../errors';
import { getNetworkPassphrase, submitSignedXdr } from '../submit';
import {
  WalletAdapter,
  WalletConnectionResult,
  WalletSignOptions,
  WalletSigningResult,
} from '../types';

/**
 * Subset of the API the xBull extension injects as `window.xBullSDK`.
 * Same shape as apps/webapp/lib/wallet/adapters/xbull-adapter.ts.
 */
interface XBullSDK {
  connect(permissions: { canRequestPublicKey: boolean; canRequestSign: boolean }): Promise<unknown>;
  getPublicKey(): Promise<string>;
  signXDR(xdr: string, options?: { network?: string; publicKey?: string }): Promise<string>;
}

function getSdk(): XBullSDK | null {
  // In a browser `globalThis` is `window`, so this reads `window.xBullSDK`.
  const sdk = (globalThis as unknown as { xBullSDK?: XBullSDK }).xBullSDK;
  return sdk ?? null;
}

function toFailure(err: unknown, fallback: string) {
  const message = walletErrorMessage(err, fallback);
  return isRejectionMessage(message)
    ? { status: 'rejected' as const, error: new WalletError('rejected', message, err) }
    : { status: 'failed' as const, error: new WalletError('unknown', message, err) };
}

/**
 * xBull adapter, ported from the webapp registry.
 *
 * xBull is a browser extension, so this adapter is only available when the
 * app runs on the Expo web target and the extension has injected its SDK. On
 * iOS and Android it reports unavailable and SEP-0007 stays the default.
 *
 * Unlike the webapp adapter, `signXdr` also submits the signed envelope
 * (see `submitSignedXdr`), because mobile callers expect a transaction hash
 * just like the SEP-0007 flow returns.
 */
export class XBullWalletAdapter implements WalletAdapter {
  readonly id = 'xbull';
  readonly name = 'xBull';
  readonly installUrl = 'https://xbull.app';

  constructor(private readonly platformOS: string = Platform.OS) {}

  isAvailable(): boolean {
    return this.platformOS === 'web' && getSdk() !== null;
  }

  async connect(): Promise<WalletConnectionResult> {
    const missing = this.unavailableResult();
    if (missing) return missing;
    const sdk = getSdk() as XBullSDK;

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
    const missing = this.unavailableResult();
    if (missing) return missing;
    const sdk = getSdk() as XBullSDK;

    let signedXdr: string;
    try {
      signedXdr = await sdk.signXDR(xdr, {
        network: options.networkPassphrase ?? getNetworkPassphrase(),
        publicKey: options.address,
      });
    } catch (err) {
      return toFailure(err, 'Signing failed');
    }

    return submitSignedXdr(signedXdr);
  }

  /** Failure to return when xBull cannot be used here, or null when it can. */
  private unavailableResult(): { status: 'failed'; error: WalletError } | null {
    if (this.platformOS !== 'web') {
      return {
        status: 'failed',
        error: new WalletError(
          'unsupported_device',
          'xBull is a browser extension and is only available in the web build.',
        ),
      };
    }
    if (!getSdk()) {
      return {
        status: 'failed',
        error: new WalletError(
          'missing_wallet',
          'xBull extension not found. Install it from xbull.app.',
        ),
      };
    }
    return null;
  }
}
