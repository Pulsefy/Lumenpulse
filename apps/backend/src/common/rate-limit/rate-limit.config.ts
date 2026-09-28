import { applyDecorators, ExecutionContext } from '@nestjs/common';
import {
  Throttle,
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../../lib/config';
import {
  MachinePrincipalType,
  PRINCIPAL_SCOPED_ENDPOINT_CLASSES,
  PrincipalScopedEndpointClass,
  RATE_LIMIT_PRINCIPAL_REQUEST_KEY,
  RateLimitEndpointClass,
  RateLimitPrincipal,
  RateLimitPrincipalType,
} from './rate-limit.constants';
import { RateLimitEndpointClass as RateLimitEndpointClassDecorator } from './rate-limit.decorator';

export interface RateLimitProfile {
  limit: number;
  ttl: number;
  blockDuration: number;
}

/** Per-class profiles for a machine principal (bot or service). */
export type PrincipalRateLimitProfiles = Record<
  PrincipalScopedEndpointClass,
  RateLimitProfile
>;

export interface RateLimitSettings {
  global: RateLimitProfile;
  auth: RateLimitProfile;
  portfolioRead: RateLimitProfile;
  portfolioWrite: RateLimitProfile;
  watchlistRead: RateLimitProfile;
  watchlistWrite: RateLimitProfile;
  newsRead: RateLimitProfile;
  projectRead: RateLimitProfile;
  crowdfundRead: RateLimitProfile;
  stellarRead: RateLimitProfile;
  searchRead: RateLimitProfile;
  analyticsRead: RateLimitProfile;
  exportJob: RateLimitProfile;
  contractSimulation: RateLimitProfile;
  friendbotBootstrap: RateLimitProfile;
  /**
   * Separately configurable limits for bot and service principals that are
   * authenticated through bot-auth.
   */
  principals: Record<MachinePrincipalType, PrincipalRateLimitProfiles>;
  tracker: {
    useIp: boolean;
    useApiKey: boolean;
    apiKeyHeader: string;
  };
  redisUrl?: string;
  redisNamespace: string;
}

const DEFAULTS = {
  development: {
    global: { limit: 300, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 15, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 200, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 30, ttl: 60_000, blockDuration: 120_000 },
    newsRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    projectRead: { limit: 100, ttl: 60_000, blockDuration: 60_000 },
    crowdfundRead: { limit: 100, ttl: 60_000, blockDuration: 60_000 },
    stellarRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    searchRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    analyticsRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    exportJob: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
    contractSimulation: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    friendbotBootstrap: { limit: 5, ttl: 3_600_000, blockDuration: 3_600_000 },
  },
  staging: {
    global: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 10, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 12, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 150, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
    newsRead: { limit: 80, ttl: 60_000, blockDuration: 60_000 },
    projectRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    crowdfundRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    stellarRead: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
    searchRead: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
    analyticsRead: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
    exportJob: { limit: 10, ttl: 60_000, blockDuration: 180_000 },
    contractSimulation: { limit: 15, ttl: 60_000, blockDuration: 120_000 },
    friendbotBootstrap: { limit: 3, ttl: 3_600_000, blockDuration: 3_600_000 },
  },
  production: {
    global: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 8, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 90, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 10, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 100, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 15, ttl: 60_000, blockDuration: 120_000 },
    newsRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    projectRead: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
    crowdfundRead: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
    stellarRead: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    searchRead: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    analyticsRead: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    exportJob: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
    contractSimulation: { limit: 10, ttl: 60_000, blockDuration: 120_000 },
    friendbotBootstrap: { limit: 2, ttl: 3_600_000, blockDuration: 3_600_000 },
  },
} as const;

/**
 * Default profiles for machine principals authenticated through bot-auth.
 *
 * Bots typically proxy many end users (e.g. a Telegram bot serving many chats)
 * and services are trusted internal callers, so their general budgets are
 * higher than a single human's — while expensive classes remain bounded.
 */
const PRINCIPAL_DEFAULTS: Record<
  EnvironmentName,
  Record<MachinePrincipalType, PrincipalRateLimitProfiles>
> = {
  development: {
    bot: {
      global: { limit: 600, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
      contractSimulation: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
    },
    service: {
      global: { limit: 1200, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 240, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 240, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 40, ttl: 60_000, blockDuration: 120_000 },
      contractSimulation: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    },
  },
  staging: {
    bot: {
      global: { limit: 400, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 80, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 80, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 10, ttl: 60_000, blockDuration: 180_000 },
      contractSimulation: { limit: 30, ttl: 60_000, blockDuration: 120_000 },
    },
    service: {
      global: { limit: 900, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 20, ttl: 60_000, blockDuration: 180_000 },
      contractSimulation: { limit: 60, ttl: 60_000, blockDuration: 120_000 },
    },
  },
  production: {
    bot: {
      global: { limit: 300, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
      contractSimulation: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
    },
    service: {
      global: { limit: 600, ttl: 60_000, blockDuration: 60_000 },
      searchRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
      analyticsRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
      exportJob: { limit: 10, ttl: 60_000, blockDuration: 300_000 },
      contractSimulation: { limit: 40, ttl: 60_000, blockDuration: 120_000 },
    },
  },
};

type EnvironmentName = keyof typeof DEFAULTS;

type ProfileKey = Exclude<
  keyof RateLimitSettings,
  'principals' | 'tracker' | 'redisUrl' | 'redisNamespace'
>;

function parseNumber(
  value: string | undefined,
  fallback: number,
  minimum = 1,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getEnvironmentName(nodeEnv: string | undefined): EnvironmentName {
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    return nodeEnv;
  }

  return 'development';
}

function toEnvSegment(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

function readProfileFromEnv(
  env: NodeJS.ProcessEnv,
  envKeyPrefix: string,
  profileDefaults: RateLimitProfile,
): RateLimitProfile {
  return {
    limit: parseNumber(
      env[`RATE_LIMIT_${envKeyPrefix}_LIMIT`],
      profileDefaults.limit,
    ),
    ttl: parseNumber(
      env[`RATE_LIMIT_${envKeyPrefix}_TTL_MS`],
      profileDefaults.ttl,
    ),
    blockDuration: parseNumber(
      env[`RATE_LIMIT_${envKeyPrefix}_BLOCK_MS`],
      profileDefaults.blockDuration,
    ),
  };
}

function resolveProfile(
  env: NodeJS.ProcessEnv,
  key: ProfileKey,
): RateLimitProfile {
  const profileDefaults = DEFAULTS[getEnvironmentName(env.NODE_ENV)][key];
  return readProfileFromEnv(env, toEnvSegment(key), profileDefaults);
}

/**
 * Resolves bot / service profiles from `RATE_LIMIT_<BOT|SERVICE>_<CLASS>_*`
 * environment variables, falling back to per-environment defaults.
 */
export function resolvePrincipalProfiles(
  env: NodeJS.ProcessEnv,
): Record<MachinePrincipalType, PrincipalRateLimitProfiles> {
  const defaults = PRINCIPAL_DEFAULTS[getEnvironmentName(env.NODE_ENV)];
  const build = (type: MachinePrincipalType): PrincipalRateLimitProfiles => {
    const entries = PRINCIPAL_SCOPED_ENDPOINT_CLASSES.map((endpointClass) => [
      endpointClass,
      readProfileFromEnv(
        env,
        `${type.toUpperCase()}_${toEnvSegment(endpointClass)}`,
        defaults[type][endpointClass],
      ),
    ]);
    return Object.fromEntries(entries) as PrincipalRateLimitProfiles;
  };

  return { bot: build('bot'), service: build('service') };
}

export function getRateLimitSettings(
  env?: NodeJS.ProcessEnv,
): RateLimitSettings {
  if (!env) {
    return {
      global: config.rateLimit.global,
      auth: config.rateLimit.auth,
      portfolioRead: config.rateLimit.portfolioRead,
      portfolioWrite: config.rateLimit.portfolioWrite,
      watchlistRead: config.rateLimit.watchlistRead,
      watchlistWrite: config.rateLimit.watchlistWrite,
      newsRead: config.rateLimit.newsRead,
      projectRead: config.rateLimit.projectRead,
      crowdfundRead: config.rateLimit.crowdfundRead,
      stellarRead: config.rateLimit.stellarRead,
      searchRead: config.rateLimit.searchRead,
      analyticsRead: config.rateLimit.analyticsRead,
      exportJob: config.rateLimit.exportJob,
      contractSimulation: config.rateLimit.contractSimulation,
      friendbotBootstrap: config.rateLimit.friendbotBootstrap,
      principals: resolvePrincipalProfiles(process.env),
      tracker: config.rateLimit.tracker,
      redisUrl: config.rateLimit.redisUrl,
      redisNamespace: config.rateLimit.redisNamespace,
    };
  }

  return {
    global: resolveProfile(env, 'global'),
    auth: resolveProfile(env, 'auth'),
    portfolioRead: resolveProfile(env, 'portfolioRead'),
    portfolioWrite: resolveProfile(env, 'portfolioWrite'),
    watchlistRead: resolveProfile(env, 'watchlistRead'),
    watchlistWrite: resolveProfile(env, 'watchlistWrite'),
    newsRead: resolveProfile(env, 'newsRead'),
    projectRead: resolveProfile(env, 'projectRead'),
    crowdfundRead: resolveProfile(env, 'crowdfundRead'),
    stellarRead: resolveProfile(env, 'stellarRead'),
    searchRead: resolveProfile(env, 'searchRead'),
    analyticsRead: resolveProfile(env, 'analyticsRead'),
    exportJob: resolveProfile(env, 'exportJob'),
    contractSimulation: resolveProfile(env, 'contractSimulation'),
    friendbotBootstrap: resolveProfile(env, 'friendbotBootstrap'),
    principals: resolvePrincipalProfiles(env),
    tracker: {
      useIp: parseBoolean(env.RATE_LIMIT_TRACK_BY_IP, true),
      useApiKey: parseBoolean(env.RATE_LIMIT_TRACK_BY_API_KEY, false),
      apiKeyHeader:
        env.RATE_LIMIT_API_KEY_HEADER?.trim().toLowerCase() || 'x-api-key',
    },
    redisUrl: env.RATE_LIMIT_REDIS_URL?.trim() || env.REDIS_URL?.trim(),
    redisNamespace: env.RATE_LIMIT_REDIS_NAMESPACE?.trim() || 'rate-limit',
  };
}

/**
 * Source-address based tracker used for unauthenticated (anonymous) callers.
 */
export function getTrackerId(
  request: Record<string, unknown>,
  settings: RateLimitSettings,
): string {
  const headers =
    (request.headers as Record<string, string | string[] | undefined>) || {};
  const headerValue = headers[settings.tracker.apiKeyHeader];
  const apiKey =
    typeof headerValue === 'string'
      ? headerValue.trim()
      : Array.isArray(headerValue)
        ? headerValue[0]?.trim()
        : '';
  const ipAddress =
    typeof request.ip === 'string' && request.ip.trim().length > 0
      ? request.ip.trim()
      : 'unknown';

  const parts: string[] = [];

  if (settings.tracker.useApiKey && apiKey) {
    parts.push(`api-key:${apiKey}`);
  }

  if (settings.tracker.useIp || parts.length === 0) {
    parts.push(`ip:${ipAddress}`);
  }

  return parts.join('|');
}

/**
 * Tracker for a request: the authenticated principal when one was resolved by
 * the guard, falling back to the source address otherwise.
 */
export function getTrackerForRequest(
  request: Record<string, unknown>,
  settings: RateLimitSettings,
): string {
  const principal = request[RATE_LIMIT_PRINCIPAL_REQUEST_KEY] as
    | RateLimitPrincipal
    | undefined;

  if (principal && principal.type !== 'anonymous' && principal.trackerKey) {
    return principal.trackerKey;
  }

  return getTrackerId(request, settings);
}

/**
 * Picks the profile that applies to a request.
 *
 * - Bot / service principals use their own profile for principal-scoped
 *   classes (global, search, analytics, export, contract simulation).
 * - Everyone else — and machine principals on any other class, e.g. auth —
 *   uses the route's standard profile (`fallback`, which already reflects any
 *   `@Throttle` override on the route).
 */
export function resolveEffectiveProfile(
  settings: RateLimitSettings,
  endpointClass: RateLimitEndpointClass,
  principalType: RateLimitPrincipalType,
  fallback: RateLimitProfile,
): RateLimitProfile {
  if (principalType === 'bot' || principalType === 'service') {
    const principalProfiles = settings.principals?.[principalType];
    const scoped = principalProfiles?.[
      endpointClass as PrincipalScopedEndpointClass
    ] as RateLimitProfile | undefined;
    if (scoped) {
      return scoped;
    }
  }

  return fallback;
}

export function createThrottlerOptions(
  settings: RateLimitSettings,
  storage: ThrottlerStorage,
): ThrottlerModuleOptions {
  const defaultThrottler: ThrottlerOptions = {
    name: 'default',
    limit: settings.global.limit,
    ttl: settings.global.ttl,
    blockDuration: settings.global.blockDuration,
  };

  return {
    throttlers: [defaultThrottler],
    storage,
    errorMessage: 'Too many requests. Please try again later.',
    getTracker: (req: Record<string, unknown>, context: ExecutionContext) => {
      void context;
      return getTrackerForRequest(req, settings);
    },
  };
}

/** `@Throttle` override for a given endpoint class. */
export function getThrottleOverride(
  endpointClass: Exclude<RateLimitEndpointClass, 'global'>,
) {
  return {
    default: getRateLimitSettings()[endpointClass],
  };
}

/**
 * Applies an endpoint class's rate-limit profile to a controller or handler.
 *
 * Combines `@Throttle(<class profile>)` with endpoint-class metadata so the
 * guard can share buckets for expensive classes, apply bot / service limits
 * and label rejection metrics.
 */
export function RateLimitPolicy(
  endpointClass: Exclude<RateLimitEndpointClass, 'global'>,
) {
  return applyDecorators(
    Throttle(getThrottleOverride(endpointClass)),
    RateLimitEndpointClassDecorator(endpointClass),
  );
}

export function getExportJobThrottleOverride() {
  return getThrottleOverride('exportJob');
}

export function getContractSimulationThrottleOverride() {
  return getThrottleOverride('contractSimulation');
}

export function getAuthThrottleOverride() {
  return {
    default: getRateLimitSettings().auth,
  };
}

export function getPortfolioReadThrottleOverride() {
  return {
    default: getRateLimitSettings().portfolioRead,
  };
}

export function getPortfolioWriteThrottleOverride() {
  return {
    default: getRateLimitSettings().portfolioWrite,
  };
}

export function getWatchlistReadThrottleOverride() {
  return {
    default: getRateLimitSettings().watchlistRead,
  };
}

export function getWatchlistWriteThrottleOverride() {
  return {
    default: getRateLimitSettings().watchlistWrite,
  };
}

export function getNewsReadThrottleOverride() {
  return {
    default: getRateLimitSettings().newsRead,
  };
}

export function getProjectReadThrottleOverride() {
  return {
    default: getRateLimitSettings().projectRead,
  };
}

export function getCrowdfundReadThrottleOverride() {
  return {
    default: getRateLimitSettings().crowdfundRead,
  };
}

export function getStellarReadThrottleOverride() {
  return {
    default: getRateLimitSettings().stellarRead,
  };
}

export function getSearchReadThrottleOverride() {
  return {
    default: getRateLimitSettings().searchRead,
  };
}

export function getAnalyticsReadThrottleOverride() {
  return {
    default: getRateLimitSettings().analyticsRead,
  };
}

export function getFriendbotBootstrapThrottleOverride() {
  return {
    default: getRateLimitSettings().friendbotBootstrap,
  };
}

export function getRegistryReadThrottleOverride() {
  return {
    default: getRateLimitSettings().crowdfundRead,
  };
}

export function getRegistryWriteThrottleOverride() {
  return {
    default: getRateLimitSettings().portfolioWrite,
  };
}
