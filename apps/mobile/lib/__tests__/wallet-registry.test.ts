import { createWalletAdapterRegistry } from '../wallet/registry';

export function testProductionRegistryExcludesMockAdapter(): boolean {
  const adapters = createWalletAdapterRegistry(false);

  return !adapters.some((adapter) => adapter.id === 'mock');
}
