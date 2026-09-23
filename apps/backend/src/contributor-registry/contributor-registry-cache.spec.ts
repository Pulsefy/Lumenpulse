import type { Cache } from 'cache-manager';
import { CacheService } from '../cache/cache.service';
import { ContributorRegistryService } from './contributor-registry.service';
import type { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';

class MemoryCache {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  set(key: string, value: unknown, ttl?: number): Promise<unknown> {
    void ttl;
    this.values.set(key, value);
    return Promise.resolve(value);
  }

  del(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }
}

describe('contributor registry cache read-after-write consistency', () => {
  it('reflects a contributor write through address, GitHub, reputation, and nonce reads', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const rpc = {
      getAccount: jest.fn(),
      sendTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
    } as unknown as SorobanRpcClientService;
    const service = new ContributorRegistryService(cacheService, rpc);
    const internals = service as unknown as {
      mockContributors: Map<string, unknown>;
      mockGithubIndex: Map<string, string>;
      mockNonces: Map<string, number>;
    };
    const address = 'GCONTRIBUTOR';
    const handle = 'old-handle';

    internals.mockContributors.set(address, {
      address,
      githubHandle: handle,
      reputationScore: 1,
      registeredAt: new Date(0).toISOString(),
    });
    internals.mockGithubIndex.set(handle, address);
    internals.mockNonces.set(address, 4);

    await service.getContributorByAddress(address);
    await service.getContributorByGithub(handle);
    await service.getReputation(address);
    expect((await service.getNonce(address)).nonce).toBe(4);

    // Model the state change delivered by a chain event, then use the same
    // centralized invalidation boundary used by the event processor.
    internals.mockContributors.set(address, {
      address,
      githubHandle: 'new-handle',
      reputationScore: 99,
      registeredAt: new Date(0).toISOString(),
    });
    internals.mockGithubIndex.set('new-handle', address);
    internals.mockNonces.set(address, 5);
    await service.invalidateContributorCaches(address, 'new-handle', true);

    expect(
      (await service.getContributorByAddress(address)).reputationScore,
    ).toBe(99);
    expect(
      (await service.getContributorByGithub('new-handle')).githubHandle,
    ).toBe('new-handle');
    expect((await service.getContributorByGithub(handle)).githubHandle).toBe(
      'new-handle',
    );
    expect((await service.getReputation(address)).reputationScore).toBe(99);
    expect((await service.getNonce(address)).nonce).toBe(5);
  });
});
