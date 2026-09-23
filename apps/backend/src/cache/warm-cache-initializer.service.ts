import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GrantsService } from '../grants/grants.service';
import { WarmCacheRegistry } from './warm-cache.registry';
import { ConfigService } from '@nestjs/config';
import {
  WARM_CACHE_KEY_DASHBOARD_SUMMARY,
  WARM_CACHE_KEY_GRANTS_LEADERBOARD,
  WARM_CACHE_KEY_GRANTS_ROUNDS,
  buildWarmLeaderboardCacheKey,
} from './cache.constants';

export {
  WARM_CACHE_KEY_DASHBOARD_SUMMARY,
  WARM_CACHE_KEY_GRANTS_LEADERBOARD,
  WARM_CACHE_KEY_GRANTS_ROUNDS,
};

/**
 * WarmCacheInitializerService
 *
 * Registers the concrete dashboard and grants API loaders with the
 * WarmCacheRegistry at module-init time.  Keeping registration separate from
 * the preloader itself means adding or removing hot routes requires no changes
 * to the scheduling or metrics code — only this file.
 */
@Injectable()
export class WarmCacheInitializerService implements OnModuleInit {
  private readonly logger = new Logger(WarmCacheInitializerService.name);

  constructor(
    private readonly registry: WarmCacheRegistry,
    private readonly grantsService: GrantsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const roundsTtl = this.configService.get<number>(
      'WARM_CACHE_TTL_GRANTS_ROUNDS_MS',
      5 * 60 * 1_000, // 5 min
    );
    const leaderboardTtl = this.configService.get<number>(
      'WARM_CACHE_TTL_GRANTS_LEADERBOARD_MS',
      10 * 60 * 1_000, // 10 min
    );

    // ── grants/rounds ──────────────────────────────────────────────────────
    this.registry.register({
      name: 'grants:rounds',
      cacheKey: WARM_CACHE_KEY_GRANTS_ROUNDS,
      ttlMs: roundsTtl,
      loader: () => {
        this.logger.debug('Preloading grants/rounds…');
        return Promise.resolve(this.grantsService.listRounds());
      },
    });

    // ── grants/leaderboard ─────────────────────────────────────────────────
    // The physical key must include the round ID. A single base key would
    // alias the default leaderboard of every round to the same response.
    const initialRounds = this.grantsService.listRounds();
    const initialRound =
      initialRounds.find((round) => round.status === 'ACTIVE') ??
      initialRounds[0];
    if (initialRound) {
      const leaderboardCacheKey = buildWarmLeaderboardCacheKey({
        roundId: initialRound.id,
        page: 1,
        limit: 10,
        topN: 10,
      });

      this.registry.register({
        name: 'grants:leaderboard',
        cacheKey: leaderboardCacheKey,
        ttlMs: leaderboardTtl,
        loader: () => {
          this.logger.debug('Preloading grants/leaderboard…');
          // Keep the preloader and the HTTP read path on the same round-specific
          // key. If a new round is created later, the normal write invalidation
          // makes the old warm entry unreachable and the next read fills its own
          // round-specific key.
          const rounds = this.grantsService.listRounds();
          const activeRound = rounds.find(
            (round) => round.id === initialRound.id,
          );
          if (!activeRound)
            return Promise.resolve({
              entries: [],
              totalCount: 0,
              hasMore: false,
              page: 1,
              limit: 20,
            });
          return Promise.resolve(
            this.grantsService.getLeaderboard({
              roundId: activeRound.id,
              topN: 10,
              page: 1,
              limit: 10,
            }),
          );
        },
      });
    }

    this.logger.log(
      `WarmCacheInitializerService: registered ${this.registry.getAll().length} route(s) for preloading.`,
    );
  }
}
