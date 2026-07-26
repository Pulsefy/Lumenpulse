import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GrantsService } from '../grants/grants.service';
import { WarmCacheRegistry } from './warm-cache.registry';
import { ConfigService } from '@nestjs/config';

// Cache-key constants (re-export so consumers can reference them without magic strings)
export const WARM_CACHE_KEY_GRANTS_ROUNDS = 'warm:grants:rounds';
export const WARM_CACHE_KEY_GRANTS_LEADERBOARD = 'warm:grants:leaderboard';
export const WARM_CACHE_KEY_DASHBOARD_SUMMARY = 'warm:dashboard:summary';

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
    this.registry.register({
      name: 'grants:leaderboard',
      cacheKey: WARM_CACHE_KEY_GRANTS_LEADERBOARD,
      ttlMs: leaderboardTtl,
      loader: () => {
        this.logger.debug('Preloading grants/leaderboard…');
        // Preload leaderboard for the most relevant round (active or latest)
        const rounds = this.grantsService.listRounds();
        const activeRound =
          rounds.find((r) => r.status === 'ACTIVE') || rounds[0];
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
            limit: 20,
          }),
        );
      },
    });

    this.logger.log(
      `WarmCacheInitializerService: registered ${this.registry.getAll().length} route(s) for preloading.`,
    );
  }
}
