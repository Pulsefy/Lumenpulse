import { SorobanEventsProcessor } from './soroban-events.processor';

type ContributorInvalidationProbe = {
  invalidateContributorCachesIfNeeded: (
    eventType: string | null | undefined,
    rawPayload: Record<string, unknown>,
  ) => Promise<void>;
};

describe('SorobanEventsProcessor contributor cache invalidation', () => {
  it('broadly evicts all representations when an event has no address', async () => {
    const cacheService = {
      invalidateContributorCaches: jest.fn().mockResolvedValue(undefined),
      invalidatePrefix: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new SorobanEventsProcessor(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cacheService as never,
    );
    const probe = processor as unknown as ContributorInvalidationProbe;

    await probe.invalidateContributorCachesIfNeeded(
      'contributor_profile_updated',
      { githubHandle: 'new-handle' },
    );

    expect(cacheService.invalidateContributorCaches).not.toHaveBeenCalled();
    expect(cacheService.invalidatePrefix).toHaveBeenCalledTimes(4);
    expect(cacheService.invalidatePrefix).toHaveBeenNthCalledWith(
      1,
      'contributor-registry:address:',
    );
    expect(cacheService.invalidatePrefix).toHaveBeenNthCalledWith(
      2,
      'contributor-registry:github:',
    );
    expect(cacheService.invalidatePrefix).toHaveBeenNthCalledWith(
      3,
      'contributor-registry:reputation:',
    );
    expect(cacheService.invalidatePrefix).toHaveBeenNthCalledWith(
      4,
      'contributor-registry:nonce:',
    );
  });
});
