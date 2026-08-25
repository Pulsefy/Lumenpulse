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
  friendbotBootstrap: RateLimitProfile;
  export: RateLimitProfile;
  contractSimulation: RateLimitProfile;
  botAuth: RateLimitProfile;
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
    friendbotBootstrap: { limit: 5, ttl: 3_600_000, blockDuration: 3_600_000 },
    export: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    contractSimulation: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
    botAuth: { limit: 100, ttl: 60_000, blockDuration: 60_000 },
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
    friendbotBootstrap: { limit: 3, ttl: 3_600_000, blockDuration: 3_600_000 },
    export: { limit: 20, ttl: 60_000, blockDuration: 60_000 },
    contractSimulation: { limit: 20, ttl: 60_000, blockDuration: 60_000 },
    botAuth: { limit: 60, ttl: 60_000, blockDuration: 60_000 },
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
    friendbotBootstrap: { limit: 2, ttl: 3_600_000, blockDuration: 3_600_000 },
    export: { limit: 10, ttl: 60_000, blockDuration: 60_000 },
    contractSimulation: { limit: 10, ttl: 60_000, blockDuration: 60_000 },
    botAuth: { limit: 40, ttl: 60_000, blockDuration: 60_000 },
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
    | 'analyticsRead'
    | 'friendbotBootstrap'
    | 'export'
    | 'contractSimulation'
    | 'botAuth',
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
  const envDefaults = DEFAULTS.development;

  if (!env) {
    return {
      global: config.rateLimit?.global ?? envDefaults.global,
      auth: config.rateLimit?.auth ?? envDefaults.auth,
      portfolioRead: config.rateLimit?.portfolioRead ?? envDefaults.portfolioRead,
      portfolioWrite: config.rateLimit?.portfolioWrite ?? envDefaults.portfolioWrite,
      watchlistRead: config.rateLimit?.watchlistRead ?? envDefaults.watchlistRead,
      watchlistWrite: config.rateLimit?.watchlistWrite ?? envDefaults.watchlistWrite,
      newsRead: config.rateLimit?.newsRead ?? envDefaults.newsRead,
      projectRead: config.rateLimit?.projectRead ?? envDefaults.projectRead,
      crowdfundRead: config.rateLimit?.crowdfundRead ?? envDefaults.crowdfundRead,
      stellarRead: config.rateLimit?.stellarRead ?? envDefaults.stellarRead,
      searchRead: config.rateLimit?.searchRead ?? envDefaults.searchRead,
      analyticsRead: config.rateLimit?.analyticsRead ?? envDefaults.analyticsRead,
      friendbotBootstrap: config.rateLimit?.friendbotBootstrap ?? envDefaults.friendbotBootstrap,
      export: (config.rateLimit as any)?.export ?? envDefaults.export,
      contractSimulation: (config.rateLimit as any)?.contractSimulation ?? envDefaults.contractSimulation,
      botAuth: (config.rateLimit as any)?.botAuth ?? envDefaults.botAuth,
      tracker: config.rateLimit?.tracker ?? {
        useIp: true,
        useApiKey: false,
        apiKeyHeader: 'x-api-key',
      },
      redisUrl: config.rateLimit?.redisUrl,
      redisNamespace: config.rateLimit?.redisNamespace ?? 'rate-limit',
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
    friendbotBootstrap: resolveProfile(env, 'friendbotBootstrap'),
    export: resolveProfile(env, 'export'),
    contractSimulation: resolveProfile(env, 'contractSimulation'),
    botAuth: resolveProfile(env, 'botAuth'),
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
  settings?: RateLimitSettings,
): string {
  const headers =
    (request.headers as Record<string, string | string[] | undefined>) || {};
  const getHeader = (key: string): string => {
    const val = headers[key.toLowerCase()] || headers[key];
    if (typeof val === 'string') return val.trim();
    if (Array.isArray(val)) return val[0]?.trim() || '';
    return '';
  };

  // 1. Authenticated User (JWT / Passport)
  const user = request.user as Record<string, unknown> | undefined;
  if (user) {
    const userId = String(
      user.id || user.sub || user.email || user.username || user.stellarPublicKey || '',
    ).trim();
    if (userId) {
      return `user:${userId}`;
    }
  }

  // 2. Authenticated Principal (AccessControl / custom principal)
  const principal = request.principal;
  if (principal) {
    const principalId =
      typeof principal === 'string'
        ? principal.trim()
        : String(
            (principal as Record<string, unknown>).id ||
              (principal as Record<string, unknown>).sub ||
              (principal as Record<string, unknown>).name ||
              '',
          ).trim();
    if (principalId) {
      return `principal:${principalId}`;
    }
  }

  // 3. Bot or Service Principal (req.bot, req.service, or bot-auth headers)
  const bot = request.bot as Record<string, unknown> | undefined;
  if (bot) {
    const botId = String(bot.id || bot.name || 'known').trim();
    if (botId) return `bot:${botId}`;
  }

  const service = request.service as Record<string, unknown> | undefined;
  if (service) {
    const serviceId = String(service.id || service.name || 'known').trim();
    if (serviceId) return `service:${serviceId}`;
  }

  const botHeader = getHeader('x-bot-id') || getHeader('x-bot-auth');
  if (botHeader) {
    return `bot:${botHeader}`;
  }

  const serviceHeader = getHeader('x-service-id') || getHeader('x-service-key');
  if (serviceHeader) {
    return `service:${serviceHeader}`;
  }

  // 4. API Key tracking
  const apiKeyHeaderName = settings?.tracker?.apiKeyHeader || 'x-api-key';
  const apiKey = getHeader(apiKeyHeaderName);
  if (settings?.tracker?.useApiKey && apiKey) {
    return `api-key:${apiKey}`;
  }

  // 5. Fallback to source IP address
  const ipAddress =
    typeof request.ip === 'string' && request.ip.trim().length > 0
      ? request.ip.trim()
      : typeof (request.socket as Record<string, unknown>)?.remoteAddress ===
          'string'
        ? ((request.socket as Record<string, unknown>).remoteAddress as string)
        : 'unknown';

  return `ip:${ipAddress}`;
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

export function getExportThrottleOverride() {
  return {
    default: getRateLimitSettings().export,
  };
}

export function getContractSimulationThrottleOverride() {
  return {
    default: getRateLimitSettings().contractSimulation,
  };
}

export function getBotAuthThrottleOverride() {
  return {
    default: getRateLimitSettings().botAuth,
  };
}

