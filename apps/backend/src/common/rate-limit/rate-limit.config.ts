import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../../lib/config';

interface RateLimitProfile {
  limit: number;
  ttl: number;
  blockDuration: number;
}

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
  },
} as const;

type EnvironmentName = keyof typeof DEFAULTS;

function parseNumber(
  value: string | undefined,
  fallback: number,
  minimum = 1,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
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

function resolveProfile(
  env: NodeJS.ProcessEnv,
  key:
    | 'global'
    | 'auth'
    | 'portfolioRead'
    | 'portfolioWrite'
    | 'watchlistRead'
    | 'watchlistWrite'
    | 'newsRead'
    | 'projectRead'
    | 'crowdfundRead'
    | 'stellarRead'
    | 'searchRead'
    | 'analyticsRead',
): RateLimitProfile {
  const profileDefaults = DEFAULTS[getEnvironmentName(env.NODE_ENV)][key];
  const envKeyPrefix = key
    .replace(/[A-Z]/g, (letter) => `_${letter}`)
    .toUpperCase();

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
      return getTrackerId(req, settings);
    },
  };
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
