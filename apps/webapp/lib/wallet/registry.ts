import { FreighterWalletAdapter } from './adapters/freighter-adapter';
import { XBullWalletAdapter } from './adapters/xbull-adapter';
import { WalletAdapter } from './types';

/**
 * Registry of supported browser wallet adapters.
 *
 * Mirrors apps/mobile/lib/wallet/registry.ts. Order matters: the first
 * available adapter is the default, and Freighter stays first so existing
 * Freighter users see no change.
 */
export function createWalletAdapterRegistry(): WalletAdapter[] {
  return [new FreighterWalletAdapter(), new XBullWalletAdapter()];
}

/** Adapters whose wallet is installed in the current browser. */
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
  adapters: WalletAdapter[] = createWalletAdapterRegistry(),
): Promise<WalletAdapter> {
  const available = await getAvailableWalletAdapters(adapters);
  // Fall back to the first adapter even if unavailable; it will surface a
  // clear `missing_wallet` error when invoked.
  return available[0] ?? adapters[0];
}

export function findWalletAdapter(
  id: string | null | undefined,
  adapters: WalletAdapter[] = createWalletAdapterRegistry(),
): WalletAdapter | undefined {
  return id ? adapters.find((a) => a.id === id) : undefined;
}
