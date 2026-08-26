import { config } from '../config';
import { MockWalletAdapter } from './adapters/mock-adapter';
import { Sep7WalletAdapter } from './adapters/sep7-adapter';
import { WalletAdapter } from './types';

/**
 * Registry of supported wallet adapters.
 *
 * Order matters: the first available adapter is selected as the default.
 * The production SEP-0007 adapter is always first. The mock adapter is only
 * included in development builds and is intentionally last so it cannot be
 * accidentally preferred in production.
 */
export function createWalletAdapterRegistry(isDevelopment = config.isDevelopment): WalletAdapter[] {
  const adapters: WalletAdapter[] = [new Sep7WalletAdapter()];

  if (isDevelopment && (typeof __DEV__ === 'undefined' || __DEV__)) {
    adapters.push(new MockWalletAdapter(true));
  }

  return adapters;
}

/**
 * Return the first available adapter for the current environment.
 */
export async function getDefaultWalletAdapter(
  isDevelopment = config.isDevelopment,
): Promise<WalletAdapter> {
  const adapters = createWalletAdapterRegistry(isDevelopment);

  for (const adapter of adapters) {
    if (await adapter.isAvailable()) {
      return adapter;
    }
  }

  // Fall back to the production adapter even if isAvailable() is false; the
  // adapter will surface a clear `missing_wallet` error when invoked.
  return adapters[0];
}
