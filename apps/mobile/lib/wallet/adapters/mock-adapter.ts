import { WalletError } from '../errors';
import { WalletAdapter, WalletConnectionResult, WalletSigningResult } from '../types';

/**
 * Deterministic mock public key used across dev flows so tests and demos
 * have a stable address without exposing real credentials.
 */
const MOCK_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function generateMockTxHash(): string {
  return Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(
    '',
  );
}

/**
 * Mock wallet adapter for local development and CI.
 *
 * This adapter is gated by `enabled`; the registry only enables it in
 * development builds. It must never become the default in production.
 */
export class MockWalletAdapter implements WalletAdapter {
  readonly id = 'mock';
  readonly name = 'Mock Stellar Wallet';

  constructor(private readonly enabled: boolean) {}

  isAvailable(): boolean {
    return this.enabled;
  }

  async connect(): Promise<WalletConnectionResult> {
    if (!this.enabled) {
      return {
        status: 'failed',
        error: new WalletError('not_available', 'Mock wallet is disabled in production builds.'),
      };
    }

    return { status: 'connected', pubkey: MOCK_PUBLIC_KEY };
  }

  async signXdr(_xdr: string): Promise<WalletSigningResult> {
    if (!this.enabled) {
      return {
        status: 'failed',
        error: new WalletError('not_available', 'Mock wallet is disabled in production builds.'),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
    return { status: 'success', txHash: generateMockTxHash() };
  }
}
