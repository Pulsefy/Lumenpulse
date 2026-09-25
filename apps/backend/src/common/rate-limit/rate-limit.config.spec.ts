import {
  getRateLimitSettings,
  getTrackerForRequest,
  resolveEffectiveProfile,
  resolvePrincipalProfiles,
} from './rate-limit.config';
import {
  ENDPOINT_CLASS_METRIC_LABELS,
  EXPENSIVE_ENDPOINT_CLASSES,
  RATE_LIMIT_ENDPOINT_CLASSES,
  RATE_LIMIT_PRINCIPAL_REQUEST_KEY,
} from './rate-limit.constants';

describe('rate-limit.config', () => {
  describe('expensive endpoint profiles', () => {
    it.each(['development', 'staging', 'production'])(
      'gives search/export/analytics/contract simulation stricter limits than global (%s)',
      (nodeEnv) => {
        const settings = getRateLimitSettings({ NODE_ENV: nodeEnv });

        for (const endpointClass of EXPENSIVE_ENDPOINT_CLASSES) {
          const profile = settings[endpointClass as 'searchRead' | 'exportJob'];
          expect(profile.limit).toBeLessThan(settings.global.limit);
        }
      },
    );

    it('reads export and contract simulation overrides from env', () => {
      const settings = getRateLimitSettings({
        NODE_ENV: 'production',
        RATE_LIMIT_EXPORT_JOB_LIMIT: '3',
        RATE_LIMIT_EXPORT_JOB_TTL_MS: '120000',
        RATE_LIMIT_CONTRACT_SIMULATION_LIMIT: '7',
        RATE_LIMIT_CONTRACT_SIMULATION_BLOCK_MS: '90000',
      });

      expect(settings.exportJob).toEqual({
        limit: 3,
        ttl: 120_000,
        blockDuration: 300_000,
      });
      expect(settings.contractSimulation).toEqual({
        limit: 7,
        ttl: 60_000,
        blockDuration: 90_000,
      });
    });

    it('exposes the new profiles through the validated app config', () => {
      const settings = getRateLimitSettings();
      expect(settings.exportJob.limit).toBeGreaterThan(0);
      expect(settings.contractSimulation.limit).toBeGreaterThan(0);
    });
  });

  describe('bot / service principal profiles', () => {
    it('are separately configurable per principal type and class', () => {
      const profiles = resolvePrincipalProfiles({
        NODE_ENV: 'production',
        RATE_LIMIT_BOT_GLOBAL_LIMIT: '500',
        RATE_LIMIT_BOT_SEARCH_READ_LIMIT: '25',
        RATE_LIMIT_SERVICE_CONTRACT_SIMULATION_LIMIT: '99',
        RATE_LIMIT_SERVICE_EXPORT_JOB_TTL_MS: '30000',
      });

      expect(profiles.bot.global.limit).toBe(500);
      expect(profiles.bot.searchRead.limit).toBe(25);
      expect(profiles.service.contractSimulation.limit).toBe(99);
      expect(profiles.service.exportJob.ttl).toBe(30_000);
      // Untouched values keep their production defaults.
      expect(profiles.service.global.limit).toBe(600);
      expect(profiles.bot.exportJob.limit).toBe(5);
    });

    it('ignores invalid values and keeps defaults', () => {
      const profiles = resolvePrincipalProfiles({
        NODE_ENV: 'production',
        RATE_LIMIT_BOT_GLOBAL_LIMIT: 'abc',
        RATE_LIMIT_SERVICE_GLOBAL_LIMIT: '0',
      });

      expect(profiles.bot.global.limit).toBe(300);
      expect(profiles.service.global.limit).toBe(600);
    });
  });

  describe('resolveEffectiveProfile', () => {
    const settings = getRateLimitSettings({ NODE_ENV: 'production' });
    const routeProfile = { limit: 11, ttl: 60_000, blockDuration: 60_000 };

    it('uses the route profile for users and anonymous callers', () => {
      expect(
        resolveEffectiveProfile(settings, 'searchRead', 'user', routeProfile),
      ).toBe(routeProfile);
      expect(
        resolveEffectiveProfile(settings, 'global', 'anonymous', routeProfile),
      ).toBe(routeProfile);
    });

    it('uses the principal profile for bots/services on scoped classes', () => {
      expect(
        resolveEffectiveProfile(settings, 'searchRead', 'bot', routeProfile),
      ).toEqual(settings.principals.bot.searchRead);
      expect(
        resolveEffectiveProfile(
          settings,
          'contractSimulation',
          'service',
          routeProfile,
        ),
      ).toEqual(settings.principals.service.contractSimulation);
    });

    it('keeps the standard profile for bots on non-scoped classes (e.g. auth)', () => {
      expect(
        resolveEffectiveProfile(settings, 'auth', 'bot', routeProfile),
      ).toBe(routeProfile);
    });
  });

  describe('getTrackerForRequest', () => {
    const settings = getRateLimitSettings({ NODE_ENV: 'production' });

    it('keys by authenticated principal where one exists', () => {
      expect(
        getTrackerForRequest(
          {
            ip: '10.0.0.1',
            [RATE_LIMIT_PRINCIPAL_REQUEST_KEY]: {
              type: 'user',
              id: 'u1',
              trackerKey: 'user:u1',
            },
          },
          settings,
        ),
      ).toBe('user:u1');
    });

    it('falls back to source address otherwise', () => {
      expect(getTrackerForRequest({ ip: '10.0.0.1' }, settings)).toBe(
        'ip:10.0.0.1',
      );
      expect(
        getTrackerForRequest(
          {
            ip: '10.0.0.1',
            [RATE_LIMIT_PRINCIPAL_REQUEST_KEY]: {
              type: 'anonymous',
              id: 'ip:10.0.0.1',
              trackerKey: 'ip:10.0.0.1',
            },
          },
          settings,
        ),
      ).toBe('ip:10.0.0.1');
    });
  });

  it('defines a metric label for every endpoint class', () => {
    for (const endpointClass of RATE_LIMIT_ENDPOINT_CLASSES) {
      expect(ENDPOINT_CLASS_METRIC_LABELS[endpointClass]).toMatch(/^[a-z_]+$/);
    }
    expect(ENDPOINT_CLASS_METRIC_LABELS.searchRead).toBe('search');
    expect(ENDPOINT_CLASS_METRIC_LABELS.exportJob).toBe('export');
    expect(ENDPOINT_CLASS_METRIC_LABELS.analyticsRead).toBe('analytics');
    expect(ENDPOINT_CLASS_METRIC_LABELS.contractSimulation).toBe(
      'contract_simulation',
    );
  });
});
