import {
  getAddress,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import { WalletError, isRejectionMessage, walletErrorMessage } from '../errors';
import {
  WalletAdapter,
  WalletConnectionResult,
  WalletSignOptions,
  WalletSigningResult,
} from '../types';

/**
 * Freighter browser-extension adapter.
 *
 * This is the only module in the webapp that imports @stellar/freighter-api.
 */
export class FreighterWalletAdapter implements WalletAdapter {
  readonly id = 'freighter';
  readonly name = 'Freighter';
  readonly installUrl = 'https://freighter.app';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'freighter' in window;
  }

  async getConnectedAddress(): Promise<string | null> {
    const { isConnected: connected } = await isConnected();
    if (!connected) return null;
    const { address } = await getAddress();
    return address || null;
  }

  async connect(): Promise<WalletConnectionResult> {
    if (!this.isAvailable()) {
      return {
        status: 'failed',
        error: new WalletError(
          'missing_wallet',
          'Freighter extension not found. Please install it to connect your Stellar wallet.',
        ),
      };
    }

    try {
      const result = await requestAccess();

      if (result.error) {
        const message = walletErrorMessage(result.error);
        if (isRejectionMessage(message)) {
          return { status: 'rejected', error: new WalletError('rejected', message) };
        }
        return { status: 'failed', error: new WalletError('unknown', message) };
      }

      if (!result.address) {
        return {
          status: 'failed',
          error: new WalletError(
            'missing_wallet',
            'Freighter wallet extension not detected. Please install it from freighter.app',
          ),
        };
      }

      return { status: 'connected', pubkey: result.address };
    } catch (err) {
      return {
        status: 'failed',
        error: new WalletError('unknown', walletErrorMessage(err, 'Failed to connect wallet'), err),
      };
    }
  }

  async signXdr(xdr: string, options: WalletSignOptions = {}): Promise<WalletSigningResult> {
    try {
      const result = await signTransaction(xdr, {
        networkPassphrase: options.networkPassphrase,
      });

      if (result.error) {
        const message = walletErrorMessage(result.error);
        return isRejectionMessage(message)
          ? { status: 'rejected', error: new WalletError('rejected', message) }
          : { status: 'failed', error: new WalletError('unknown', message) };
      }

      return { status: 'success', signedXdr: result.signedTxXdr };
    } catch (err) {
      return {
        status: 'failed',
        error: new WalletError('unknown', walletErrorMessage(err, 'Signing failed'), err),
      };
    }
  }
}
