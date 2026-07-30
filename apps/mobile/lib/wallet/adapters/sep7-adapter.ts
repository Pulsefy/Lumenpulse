import * as Linking from 'expo-linking';
import { WalletError } from '../errors';
import { WalletAdapter, WalletConnectionResult, WalletSigningResult } from '../types';

/**
 * SEP-0007 deep-link wallet adapter.
 *
 * Uses `web+stellar:` URIs to delegate transaction signing to an installed
 * Stellar wallet (e.g. Lobstr, Albedo). This is the production signing path
 * for the mobile app because it does not require bundling the Stellar SDK or
 * holding private keys in-app.
 */
export class Sep7WalletAdapter implements WalletAdapter {
  readonly id = 'sep7';
  readonly name = 'Stellar Wallet (SEP-0007)';

  private callbackUrl: string;

  constructor(callbackScheme = 'wallet-callback') {
    this.callbackUrl = encodeURIComponent(Linking.createURL(callbackScheme));
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await Linking.canOpenURL(
        'web+stellar:pay?destination=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF&amount=0',
      );
    } catch {
      return false;
    }
  }

  async connect(): Promise<WalletConnectionResult> {
    // SEP-0007 does not define an auth URI, so we use a minimal pay URI as a
    // wallet-discovery handshake. The actual public key is received via the
    // deep-link callback in the host context.
    const url = `web+stellar:pay?destination=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF&amount=0&callback=${this.callbackUrl}`;

    const canOpen = await this.isAvailable();
    if (!canOpen) {
      return {
        status: 'failed',
        error: new WalletError(
          'missing_wallet',
          'No Stellar wallet app installed to handle the connection request.',
        ),
      };
    }

    await Linking.openURL(url);
    return { status: 'connected' };
  }

  async signXdr(xdr: string): Promise<WalletSigningResult> {
    const url = `web+stellar:tx?xdr=${encodeURIComponent(xdr)}&callback=${this.callbackUrl}`;

    const canOpen = await this.isAvailable();
    if (!canOpen) {
      return {
        status: 'failed',
        error: new WalletError(
          'missing_wallet',
          'No Stellar wallet app installed to handle the signature request.',
        ),
      };
    }

    try {
      await Linking.openURL(url);
      // The signed result (or rejection) arrives asynchronously through the
      // deep-link callback. The context layer is responsible for correlating
      // the callback with the pending signing promise.
      return { status: 'pending' };
    } catch (error) {
      return {
        status: 'failed',
        error: new WalletError(
          'unsupported_device',
          'Could not open the wallet app on this device.',
          error,
        ),
      };
    }
  }
}
