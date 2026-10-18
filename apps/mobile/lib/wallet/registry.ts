import { Platform } from 'react-native';
import { config } from '../config';
import { MockWalletAdapter } from './adapters/mock-adapter';
import { Sep7WalletAdapter } from './adapters/sep7-adapter';
import { XBullWalletAdapter } from './adapters/xbull-adapter';
import { WalletAdapter, WalletSigningState } from './types';

/**
 * Registry of supported wallet adapters.
 *
 * Mirrors apps/webapp/lib/wallet/registry.ts. Order matters: the first
 * available adapter is selected as the default. On iOS and Android the
 * production SEP-0007 adapter is first, and xBull (a browser extension)
 * reports unavailable. On the Expo web target xBull comes first, as in the
 * webapp, because a browser rarely handles `web+stellar:` links. The mock
 * adapter is only included in development builds and is intentionally last
 * so it cannot be accidentally preferred in production.
 */
export function createWalletAdapterRegistry(
  isDevelopment = config.isDevelopment,
  platformOS: string = Platform.OS,
): WalletAdapter[] {
  const sep7 = new Sep7WalletAdapter();
  const xbull = new XBullWalletAdapter(platformOS);
  const adapters: WalletAdapter[] = platformOS === 'web' ? [xbull, sep7] : [sep7, xbull];

  if (isDevelopment && (typeof __DEV__ === 'undefined' || __DEV__)) {
    adapters.push(new MockWalletAdapter(true));
  }

  return adapters;
}

/** Adapters whose wallet can be used on the current device, in registry order. */
export async function getAvailableWalletAdapters(
  adapters: WalletAdapter[] = createWalletAdapterRegistry(),
): Promise<WalletAdapter[]> {
  const checks = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return (await adapter.isAvailable()) ? adapter : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((a): a is WalletAdapter => a !== null);
}

/**
 * Return the first available adapter for the current environment.
 */
export async function getDefaultWalletAdapter(
  isDevelopment = config.isDevelopment,
): Promise<WalletAdapter> {
  const adapters = createWalletAdapterRegistry(isDevelopment);
  const available = await getAvailableWalletAdapters(adapters);

  // Fall back to the first adapter even if isAvailable() is false; the
  // adapter will surface a clear `missing_wallet` error when invoked.
  return available[0] ?? adapters[0];
}

export function findWalletAdapter(
  id: string | null | undefined,
  adapters: WalletAdapter[] = createWalletAdapterRegistry(),
): WalletAdapter | undefined {
  return id ? adapters.find((a) => a.id === id) : undefined;
}

export type WalletSwitchDecision =
  | { status: 'unchanged' }
  | { status: 'busy' }
  | { status: 'unknown' }
  | { status: 'switch'; adapter: WalletAdapter };

/**
 * Decide whether the active wallet can be replaced by `nextId`.
 *
 * Switching is refused while a signature is in flight, because the pending
 * request belongs to the current wallet. The caller clears the session before
 * it installs the adapter returned with `switch`.
 */
export function resolveWalletSwitch(
  currentId: string | null,
  nextId: string,
  signingState: WalletSigningState,
  adapters: WalletAdapter[] = createWalletAdapterRegistry(),
): WalletSwitchDecision {
  if (currentId === nextId) return { status: 'unchanged' };
  if (signingState === 'signing' || signingState === 'pending') return { status: 'busy' };

  const adapter = findWalletAdapter(nextId, adapters);
  return adapter ? { status: 'switch', adapter } : { status: 'unknown' };
}
