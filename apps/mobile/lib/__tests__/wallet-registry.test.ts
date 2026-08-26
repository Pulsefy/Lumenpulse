import { createWalletAdapterRegistry } from '../wallet/registry';

describe('wallet registry', () => {
  test('production registry excludes mock adapter', () => {
    const adapters = createWalletAdapterRegistry(false);
    expect(adapters.some((adapter) => adapter.id === 'mock')).toBe(false);
  });
});
