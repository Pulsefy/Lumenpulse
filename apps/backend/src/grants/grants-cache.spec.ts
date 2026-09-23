import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';

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

describe('grants warm-cache read-after-write consistency', () => {
  it('does not serve a warm rounds response after a grant write', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const grantsService = new GrantsService(
      { get: jest.fn() } as unknown as ConfigService,
      { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue,
      cacheService,
    );
    const controller = new GrantsController(grantsService, cacheService);

    const first = await controller.listRounds();
    expect(first).toHaveLength(0);

    grantsService.createRound({
      name: 'New round',
      tokenAddress: 'GT',
      startTime: Math.floor(Date.now() / 1000) - 60,
      endTime: Math.floor(Date.now() / 1000) + 3600,
    });

    const second = await controller.listRounds();
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe('New round');
  });

  it('invalidates both warm leaderboard and rounds generations before deletion completes', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const grantsService = new GrantsService(
      { get: jest.fn() } as unknown as ConfigService,
      { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue,
      cacheService,
    );
    const controller = new GrantsController(grantsService, cacheService);
    const now = Math.floor(Date.now() / 1000);
    const round = grantsService.createRound({
      name: 'Round to mutate',
      tokenAddress: 'GT',
      startTime: now - 60,
      endTime: now + 3600,
    });

    await controller.getLeaderboard({
      roundId: round.id,
      topN: 10,
      page: 1,
      limit: 10,
    });
    grantsService.fundPool({
      roundId: round.id,
      amount: '100',
      funderPublicKey: 'G-FUNDER',
    });

    const leaderboard = await controller.getLeaderboard({
      roundId: round.id,
      topN: 10,
      page: 1,
      limit: 10,
    });
    expect(leaderboard.poolBalance).toBe('100');
  });

  it('keeps default leaderboard caches isolated by round', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const grantsService = new GrantsService(
      { get: jest.fn() } as unknown as ConfigService,
      { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue,
      cacheService,
    );
    const controller = new GrantsController(grantsService, cacheService);
    const now = Math.floor(Date.now() / 1000);

    const firstRound = grantsService.createRound({
      name: 'First round',
      tokenAddress: 'GT1',
      startTime: now - 60,
      endTime: now + 3600,
    });
    const secondRound = grantsService.createRound({
      name: 'Second round',
      tokenAddress: 'GT2',
      startTime: now - 60,
      endTime: now + 3600,
    });

    const first = await controller.getLeaderboard({
      roundId: firstRound.id,
      topN: 10,
      page: 1,
      limit: 10,
    });
    const second = await controller.getLeaderboard({
      roundId: secondRound.id,
      topN: 10,
      page: 1,
      limit: 10,
    });

    expect(first.round.id).toBe(firstRound.id);
    expect(second.round.id).toBe(secondRound.id);
  });
});
