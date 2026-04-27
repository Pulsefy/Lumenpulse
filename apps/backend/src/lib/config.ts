import { existsSync } from 'node:fs';
import { inspect } from 'node:util';
import * as path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment variable inventory and classification
 *
 * REQUIRED_SECRET:
 * - DB_PASSWORD
 * - JWT_SECRET
 * - STELLAR_SERVER_SECRET
 *
 * REQUIRED_CONFIG:
 * - DB_HOST
 * - DB_PORT
 * - DB_USERNAME
 * - DB_DATABASE (or DB_NAME fallback)
 * - PORT
 *
 * OPTIONAL_CONFIG:
 * - ENVIRONMENT
 * - NODE_ENV
 * - CORS_ORIGIN
 * - REDIS_HOST
 * - REDIS_PORT
 * - REDIS_URL
 * - CACHE_TTL_MS
 * - COINDESK_API_KEY
 * - PYTHON_API_URL
 * - PYTHON_SERVICE_URL
 * - PYTHON_API_KEY
 * - DOMAIN
 * - JWT_EXPIRES_IN
 * - STELLAR_NETWORK
 * - STELLAR_HORIZON_URL
 * - STELLAR_TIMEOUT
 * - STELLAR_RETRY_ATTEMPTS
 * - STELLAR_RETRY_DELAY
 * - WEBHOOK_SECRET
 * - WEBHOOK_PROVIDERS
 * - TELEGRAM_BOT_TOKEN
 * - METRICS_ALLOWED_IPS
 * - USE_MOCK_TRANSACTIONS
 * - LOGGING_ENABLED
 * - LOGGING_LEVEL
 * - LOGGING_INCLUDE_BODY
 * - LOGGING_INCLUDE_RESPONSE
 * - LOGGING_INCLUDE_IP
 * - LOGGING_INCLUDE_USER_AGENT
 * - LOGGING_EXCLUDE_ROUTES
 * - AWS_BUCKET_NAME
 * - AWS_REGION
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - FRONTEND_URL
 * - PORTFOLIO_SNAPSHOT_CONCURRENCY
 * - PORTFOLIO_SNAPSHOT_BATCH_SIZE
 * - PORTFOLIO_SNAPSHOT_ATTEMPTS
 * - PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS
 * - PORTFOLIO_SNAPSHOT_QUEUE_METRICS
 * - RATE_LIMIT_TRACK_BY_IP
 * - RATE_LIMIT_TRACK_BY_API_KEY
 * - RATE_LIMIT_API_KEY_HEADER
 * - RATE_LIMIT_REDIS_URL
 * - RATE_LIMIT_REDIS_NAMESPACE
 * - RATE_LIMIT_GLOBAL_LIMIT
 * - RATE_LIMIT_GLOBAL_TTL_MS
 * - RATE_LIMIT_GLOBAL_BLOCK_MS
 * - RATE_LIMIT_AUTH_LIMIT
 * - RATE_LIMIT_AUTH_TTL_MS
 * - RATE_LIMIT_AUTH_BLOCK_MS
 * - RATE_LIMIT_PORTFOLIO_READ_LIMIT
 * - RATE_LIMIT_PORTFOLIO_READ_TTL_MS
 * - RATE_LIMIT_PORTFOLIO_READ_BLOCK_MS
 * - RATE_LIMIT_PORTFOLIO_WRITE_LIMIT
 * - RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS
 * - RATE_LIMIT_PORTFOLIO_WRITE_BLOCK_MS
 * - RATE_LIMIT_WATCHLIST_READ_LIMIT
 * - RATE_LIMIT_WATCHLIST_READ_TTL_MS
 * - RATE_LIMIT_WATCHLIST_READ_BLOCK_MS
 * - RATE_LIMIT_WATCHLIST_WRITE_LIMIT
 * - RATE_LIMIT_WATCHLIST_WRITE_TTL_MS
 * - RATE_LIMIT_WATCHLIST_WRITE_BLOCK_MS
 *
 * NEVER_SERVER:
 * - NEXT_PUBLIC_* (validated client-side only)
 */

const LOCAL_ENV_CANDIDATE = path.resolve(process.cwd(), '.env.local');
const NON_LOCAL_ENV_FILES = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.local'),
];

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return TRUE_VALUES.has(trimmed.toLowerCase());
};

const splitCsv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const isNodeEnvironment = (value: string): value is NodeEnvironment =>
  value === 'development' ||
  value === 'test' ||
  value === 'staging' ||
  value === 'production';

const RATE_LIMIT_DEFAULTS = {
  development: {
    global: { limit: 300, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 15, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 200, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 30, ttl: 60_000, blockDuration: 120_000 },
  },
  staging: {
    global: { limit: 180, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 10, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 12, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 150, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 20, ttl: 60_000, blockDuration: 120_000 },
  },
  production: {
    global: { limit: 120, ttl: 60_000, blockDuration: 60_000 },
    auth: { limit: 8, ttl: 60_000, blockDuration: 300_000 },
    portfolioRead: { limit: 90, ttl: 60_000, blockDuration: 60_000 },
    portfolioWrite: { limit: 10, ttl: 60_000, blockDuration: 120_000 },
    watchlistRead: { limit: 100, ttl: 60_000, blockDuration: 60_000 },
    watchlistWrite: { limit: 15, ttl: 60_000, blockDuration: 120_000 },
  },
} as const;

const getRateLimitEnvironment = (
  nodeEnv: NodeEnvironment,
): keyof typeof RATE_LIMIT_DEFAULTS => {
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    return nodeEnv;
  }
  return 'development';
};

export class SecretString {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}

const normalizeRuntimeEnvironment = (): {
  nodeEnv: NodeEnvironment;
  environment: string;
  nodeEnvWasDefaulted: boolean;
} => {
  const rawNodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  const rawEnvironment = process.env.ENVIRONMENT?.trim().toLowerCase();

  let nodeEnv: NodeEnvironment;
  let nodeEnvWasDefaulted = false;

  if (
    rawNodeEnv === 'development' ||
    rawNodeEnv === 'test' ||
    rawNodeEnv === 'staging' ||
    rawNodeEnv === 'production'
  ) {
    nodeEnv = rawNodeEnv;
  } else if (
    rawEnvironment === 'development' ||
    rawEnvironment === 'test' ||
    rawEnvironment === 'staging' ||
    rawEnvironment === 'production'
  ) {
    nodeEnv = rawEnvironment;
  } else {
    nodeEnv = 'development';
    nodeEnvWasDefaulted = true;
    console.warn(
      'WARNING: NODE_ENV/ENVIRONMENT not set. Defaulting to development.',
    );
  }

  process.env.NODE_ENV = nodeEnv;

  const environment = rawEnvironment || nodeEnv;
  if (!process.env.ENVIRONMENT) {
    process.env.ENVIRONMENT = environment;
  }

  return { nodeEnv, environment, nodeEnvWasDefaulted };
};

const loadEnvironmentSources = (): {
  nodeEnv: NodeEnvironment;
  environment: string;
  nodeEnvWasDefaulted: boolean;
} => {
  const normalized = normalizeRuntimeEnvironment();
  const isLocalEnvironment =
    normalized.nodeEnv === 'development' || normalized.environment === 'local';

  if (isLocalEnvironment) {
    if (existsSync(LOCAL_ENV_CANDIDATE)) {
      dotenv.config({ path: LOCAL_ENV_CANDIDATE });
    } else {
      console.warn(
        `WARNING: Local environment file not found at ${LOCAL_ENV_CANDIDATE}`,
      );
    }
    return normalized;
  }

  const hasUnexpectedEnvFiles = NON_LOCAL_ENV_FILES.some((candidate) =>
    existsSync(candidate),
  );

  if (hasUnexpectedEnvFiles) {
    console.warn(
      'WARNING: .env file detected in a non-local environment. Secrets must be injected via the platform — not committed files.',
    );
  }

  return normalized;
};

const runtime = loadEnvironmentSources();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    ENVIRONMENT: z.string().min(1).default(runtime.environment),

    PORT: z.coerce.number().int().min(1).max(65535),

    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1), // SECRET — never log
    DB_DATABASE: z.string().min(1),

    CORS_ORIGIN: z.string().trim().optional(),

    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_URL: z.string().trim().default('redis://localhost:6379'),
    CACHE_TTL_MS: z.coerce.number().int().min(1).default(300_000),

    RATE_LIMIT_TRACK_BY_IP: z.preprocess(
      parseBoolean,
      z.boolean().default(true),
    ),
    RATE_LIMIT_TRACK_BY_API_KEY: z.preprocess(
      parseBoolean,
      z.boolean().default(false),
    ),
    RATE_LIMIT_API_KEY_HEADER: z.string().trim().default('x-api-key'),
    RATE_LIMIT_REDIS_URL: z.string().trim().optional(),
    RATE_LIMIT_REDIS_NAMESPACE: z.string().trim().default('rate-limit'),

    RATE_LIMIT_GLOBAL_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_GLOBAL_TTL_MS: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_GLOBAL_BLOCK_MS: z.coerce.number().int().min(1).optional(),

    RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_AUTH_TTL_MS: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_AUTH_BLOCK_MS: z.coerce.number().int().min(1).optional(),

    RATE_LIMIT_PORTFOLIO_READ_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_PORTFOLIO_READ_TTL_MS: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_PORTFOLIO_READ_BLOCK_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),

    RATE_LIMIT_PORTFOLIO_WRITE_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),
    RATE_LIMIT_PORTFOLIO_WRITE_BLOCK_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),

    RATE_LIMIT_WATCHLIST_READ_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_WATCHLIST_READ_TTL_MS: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_WATCHLIST_READ_BLOCK_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),

    RATE_LIMIT_WATCHLIST_WRITE_LIMIT: z.coerce.number().int().min(1).optional(),
    RATE_LIMIT_WATCHLIST_WRITE_TTL_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),
    RATE_LIMIT_WATCHLIST_WRITE_BLOCK_MS: z.coerce
      .number()
      .int()
      .min(1)
      .optional(),

    STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    STELLAR_HORIZON_URL: z.string().trim().optional(),
    STELLAR_TIMEOUT: z.coerce.number().int().min(1).default(30_000),
    STELLAR_RETRY_ATTEMPTS: z.coerce.number().int().min(0).default(3),
    STELLAR_RETRY_DELAY: z.coerce.number().int().min(0).default(1_000),
    STELLAR_SERVER_SECRET: z.string().min(1), // SECRET — never log

    PYTHON_API_URL: z.string().trim().default('http://localhost:8000'),
    PYTHON_SERVICE_URL: z.string().trim().optional(),
    PYTHON_API_KEY: z.string().trim().optional(),

    COINDESK_API_KEY: z.string().trim().optional(),

    JWT_SECRET: z.string().min(1), // SECRET — never log
    JWT_EXPIRES_IN: z.string().trim().default('7d'),
    DOMAIN: z.string().trim().default('lumenpulse.io'),

    WEBHOOK_SECRET: z.string().trim().optional(),
    WEBHOOK_PROVIDERS: z.string().trim().optional(),

    TELEGRAM_BOT_TOKEN: z.string().trim().optional(),
    METRICS_ALLOWED_IPS: z.string().trim().optional(),
    USE_MOCK_TRANSACTIONS: z.preprocess(
      parseBoolean,
      z.boolean().default(true),
    ),

    LOGGING_ENABLED: z.preprocess(parseBoolean, z.boolean().default(true)),
    LOGGING_LEVEL: z.enum(['log', 'warn', 'error']).default('log').optional(),
    LOGGING_INCLUDE_BODY: z.preprocess(
      parseBoolean,
      z.boolean().default(false),
    ),
    LOGGING_INCLUDE_RESPONSE: z.preprocess(
      parseBoolean,
      z.boolean().default(false),
    ),
    LOGGING_INCLUDE_IP: z.preprocess(parseBoolean, z.boolean().default(true)),
    LOGGING_INCLUDE_USER_AGENT: z.preprocess(
      parseBoolean,
      z.boolean().default(true),
    ),
    LOGGING_EXCLUDE_ROUTES: z.string().trim().optional(),

    AWS_BUCKET_NAME: z.string().trim().optional(),
    AWS_REGION: z.string().trim().optional(),
    AWS_ACCESS_KEY_ID: z.string().trim().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().trim().optional(),

    FRONTEND_URL: z.string().trim().default('http://localhost:3000'),

    PORTFOLIO_SNAPSHOT_CONCURRENCY: z.coerce.number().int().min(1).default(25),
    PORTFOLIO_SNAPSHOT_BATCH_SIZE: z.coerce.number().int().min(1).default(500),
    PORTFOLIO_SNAPSHOT_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(5_000),
    PORTFOLIO_SNAPSHOT_QUEUE_METRICS: z.preprocess(
      parseBoolean,
      z.boolean().default(false),
    ),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production' && !values.CORS_ORIGIN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'CORS_ORIGIN must be set in production. Restrict CORS to your frontend URL(s).',
        path: ['CORS_ORIGIN'],
      });
    }
  });

const rawEnvironment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || runtime.nodeEnv,
  ENVIRONMENT: process.env.ENVIRONMENT || runtime.environment,
  DB_DATABASE:
    process.env.DB_DATABASE || process.env.DB_NAME || process.env.DB_DATABASE,
};

const parseResult = envSchema.safeParse(rawEnvironment);

if (!parseResult.success) {
  const details = parseResult.error.issues
    .map((issue) => {
      const variable =
        issue.path.length > 0 ? issue.path.join('.') : 'ENVIRONMENT';
      return `${variable}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(
    `Configuration validation failed. Fix the following variables:\n${details}`,
  );
}

const parsedEnv = parseResult.data;
const rateLimitDefaults =
  RATE_LIMIT_DEFAULTS[getRateLimitEnvironment(parsedEnv.NODE_ENV)];

const resolvedRateLimit = {
  global: {
    limit: parsedEnv.RATE_LIMIT_GLOBAL_LIMIT ?? rateLimitDefaults.global.limit,
    ttl: parsedEnv.RATE_LIMIT_GLOBAL_TTL_MS ?? rateLimitDefaults.global.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_GLOBAL_BLOCK_MS ??
      rateLimitDefaults.global.blockDuration,
  },
  auth: {
    limit: parsedEnv.RATE_LIMIT_AUTH_LIMIT ?? rateLimitDefaults.auth.limit,
    ttl: parsedEnv.RATE_LIMIT_AUTH_TTL_MS ?? rateLimitDefaults.auth.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_AUTH_BLOCK_MS ??
      rateLimitDefaults.auth.blockDuration,
  },
  portfolioRead: {
    limit:
      parsedEnv.RATE_LIMIT_PORTFOLIO_READ_LIMIT ??
      rateLimitDefaults.portfolioRead.limit,
    ttl:
      parsedEnv.RATE_LIMIT_PORTFOLIO_READ_TTL_MS ??
      rateLimitDefaults.portfolioRead.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_PORTFOLIO_READ_BLOCK_MS ??
      rateLimitDefaults.portfolioRead.blockDuration,
  },
  portfolioWrite: {
    limit:
      parsedEnv.RATE_LIMIT_PORTFOLIO_WRITE_LIMIT ??
      rateLimitDefaults.portfolioWrite.limit,
    ttl:
      parsedEnv.RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS ??
      rateLimitDefaults.portfolioWrite.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_PORTFOLIO_WRITE_BLOCK_MS ??
      rateLimitDefaults.portfolioWrite.blockDuration,
  },
  watchlistRead: {
    limit:
      parsedEnv.RATE_LIMIT_WATCHLIST_READ_LIMIT ??
      rateLimitDefaults.watchlistRead.limit,
    ttl:
      parsedEnv.RATE_LIMIT_WATCHLIST_READ_TTL_MS ??
      rateLimitDefaults.watchlistRead.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_WATCHLIST_READ_BLOCK_MS ??
      rateLimitDefaults.watchlistRead.blockDuration,
  },
  watchlistWrite: {
    limit:
      parsedEnv.RATE_LIMIT_WATCHLIST_WRITE_LIMIT ??
      rateLimitDefaults.watchlistWrite.limit,
    ttl:
      parsedEnv.RATE_LIMIT_WATCHLIST_WRITE_TTL_MS ??
      rateLimitDefaults.watchlistWrite.ttl,
    blockDuration:
      parsedEnv.RATE_LIMIT_WATCHLIST_WRITE_BLOCK_MS ??
      rateLimitDefaults.watchlistWrite.blockDuration,
  },
};

const requiredConfigSummary = [
  ['DB_HOST', parsedEnv.DB_HOST],
  ['DB_PORT', String(parsedEnv.DB_PORT)],
  ['DB_USERNAME', parsedEnv.DB_USERNAME],
  ['DB_DATABASE', parsedEnv.DB_DATABASE],
  ['PORT', String(parsedEnv.PORT)],
] as const;

const requiredSecretSummary = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'STELLAR_SERVER_SECRET',
];

const optionalSummary = [
  ['NODE_ENV', parsedEnv.NODE_ENV],
  ['ENVIRONMENT', parsedEnv.ENVIRONMENT],
  ['CORS_ORIGIN', parsedEnv.CORS_ORIGIN ?? '(not set)'],
  ['REDIS_HOST', parsedEnv.REDIS_HOST],
  ['REDIS_PORT', String(parsedEnv.REDIS_PORT)],
  ['REDIS_URL', parsedEnv.REDIS_URL],
  ['CACHE_TTL_MS', String(parsedEnv.CACHE_TTL_MS)],
  ['RATE_LIMIT_TRACK_BY_IP', String(parsedEnv.RATE_LIMIT_TRACK_BY_IP)],
  [
    'RATE_LIMIT_TRACK_BY_API_KEY',
    String(parsedEnv.RATE_LIMIT_TRACK_BY_API_KEY),
  ],
  ['RATE_LIMIT_API_KEY_HEADER', parsedEnv.RATE_LIMIT_API_KEY_HEADER],
  ['RATE_LIMIT_REDIS_URL', parsedEnv.RATE_LIMIT_REDIS_URL ?? '(not set)'],
  ['RATE_LIMIT_REDIS_NAMESPACE', parsedEnv.RATE_LIMIT_REDIS_NAMESPACE],
  ['RATE_LIMIT_GLOBAL_LIMIT', String(resolvedRateLimit.global.limit)],
  ['RATE_LIMIT_GLOBAL_TTL_MS', String(resolvedRateLimit.global.ttl)],
  [
    'RATE_LIMIT_GLOBAL_BLOCK_MS',
    String(resolvedRateLimit.global.blockDuration),
  ],
  ['RATE_LIMIT_AUTH_LIMIT', String(resolvedRateLimit.auth.limit)],
  ['RATE_LIMIT_AUTH_TTL_MS', String(resolvedRateLimit.auth.ttl)],
  ['RATE_LIMIT_AUTH_BLOCK_MS', String(resolvedRateLimit.auth.blockDuration)],
  [
    'RATE_LIMIT_PORTFOLIO_READ_LIMIT',
    String(resolvedRateLimit.portfolioRead.limit),
  ],
  [
    'RATE_LIMIT_PORTFOLIO_READ_TTL_MS',
    String(resolvedRateLimit.portfolioRead.ttl),
  ],
  [
    'RATE_LIMIT_PORTFOLIO_READ_BLOCK_MS',
    String(resolvedRateLimit.portfolioRead.blockDuration),
  ],
  [
    'RATE_LIMIT_PORTFOLIO_WRITE_LIMIT',
    String(resolvedRateLimit.portfolioWrite.limit),
  ],
  [
    'RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS',
    String(resolvedRateLimit.portfolioWrite.ttl),
  ],
  [
    'RATE_LIMIT_PORTFOLIO_WRITE_BLOCK_MS',
    String(resolvedRateLimit.portfolioWrite.blockDuration),
  ],
  [
    'RATE_LIMIT_WATCHLIST_READ_LIMIT',
    String(resolvedRateLimit.watchlistRead.limit),
  ],
  [
    'RATE_LIMIT_WATCHLIST_READ_TTL_MS',
    String(resolvedRateLimit.watchlistRead.ttl),
  ],
  [
    'RATE_LIMIT_WATCHLIST_READ_BLOCK_MS',
    String(resolvedRateLimit.watchlistRead.blockDuration),
  ],
  [
    'RATE_LIMIT_WATCHLIST_WRITE_LIMIT',
    String(resolvedRateLimit.watchlistWrite.limit),
  ],
  [
    'RATE_LIMIT_WATCHLIST_WRITE_TTL_MS',
    String(resolvedRateLimit.watchlistWrite.ttl),
  ],
  [
    'RATE_LIMIT_WATCHLIST_WRITE_BLOCK_MS',
    String(resolvedRateLimit.watchlistWrite.blockDuration),
  ],
  ['STELLAR_NETWORK', parsedEnv.STELLAR_NETWORK],
  ['STELLAR_HORIZON_URL', parsedEnv.STELLAR_HORIZON_URL ?? '(auto)'],
  ['STELLAR_TIMEOUT', String(parsedEnv.STELLAR_TIMEOUT)],
  ['STELLAR_RETRY_ATTEMPTS', String(parsedEnv.STELLAR_RETRY_ATTEMPTS)],
  ['STELLAR_RETRY_DELAY', String(parsedEnv.STELLAR_RETRY_DELAY)],
  ['PYTHON_API_URL', parsedEnv.PYTHON_API_URL],
  [
    'PYTHON_SERVICE_URL',
    parsedEnv.PYTHON_SERVICE_URL ?? '(defaults to PYTHON_API_URL)',
  ],
  ['PYTHON_API_KEY', parsedEnv.PYTHON_API_KEY ? '[REDACTED]' : '(not set)'],
  ['COINDESK_API_KEY', parsedEnv.COINDESK_API_KEY ? '[REDACTED]' : '(not set)'],
  ['JWT_EXPIRES_IN', parsedEnv.JWT_EXPIRES_IN],
  ['DOMAIN', parsedEnv.DOMAIN],
  ['WEBHOOK_SECRET', parsedEnv.WEBHOOK_SECRET ? '[REDACTED]' : '(not set)'],
  [
    'WEBHOOK_PROVIDERS',
    parsedEnv.WEBHOOK_PROVIDERS ? '[REDACTED]' : '(not set)',
  ],
  [
    'TELEGRAM_BOT_TOKEN',
    parsedEnv.TELEGRAM_BOT_TOKEN ? '[REDACTED]' : '(not set)',
  ],
  ['METRICS_ALLOWED_IPS', parsedEnv.METRICS_ALLOWED_IPS ?? '(not set)'],
  ['USE_MOCK_TRANSACTIONS', String(parsedEnv.USE_MOCK_TRANSACTIONS)],
  ['LOGGING_ENABLED', String(parsedEnv.LOGGING_ENABLED)],
  ['LOGGING_LEVEL', parsedEnv.LOGGING_LEVEL ?? 'log'],
  ['LOGGING_INCLUDE_BODY', String(parsedEnv.LOGGING_INCLUDE_BODY)],
  ['LOGGING_INCLUDE_RESPONSE', String(parsedEnv.LOGGING_INCLUDE_RESPONSE)],
  ['LOGGING_INCLUDE_IP', String(parsedEnv.LOGGING_INCLUDE_IP)],
  ['LOGGING_INCLUDE_USER_AGENT', String(parsedEnv.LOGGING_INCLUDE_USER_AGENT)],
  [
    'LOGGING_EXCLUDE_ROUTES',
    parsedEnv.LOGGING_EXCLUDE_ROUTES ?? '(default routes)',
  ],
  ['AWS_BUCKET_NAME', parsedEnv.AWS_BUCKET_NAME ?? '(not set)'],
  ['AWS_REGION', parsedEnv.AWS_REGION ?? '(not set)'],
  [
    'AWS_ACCESS_KEY_ID',
    parsedEnv.AWS_ACCESS_KEY_ID ? '[REDACTED]' : '(not set)',
  ],
  [
    'AWS_SECRET_ACCESS_KEY',
    parsedEnv.AWS_SECRET_ACCESS_KEY ? '[REDACTED]' : '(not set)',
  ],
  ['FRONTEND_URL', parsedEnv.FRONTEND_URL],
  [
    'PORTFOLIO_SNAPSHOT_CONCURRENCY',
    String(parsedEnv.PORTFOLIO_SNAPSHOT_CONCURRENCY),
  ],
  [
    'PORTFOLIO_SNAPSHOT_BATCH_SIZE',
    String(parsedEnv.PORTFOLIO_SNAPSHOT_BATCH_SIZE),
  ],
  [
    'PORTFOLIO_SNAPSHOT_ATTEMPTS',
    String(parsedEnv.PORTFOLIO_SNAPSHOT_ATTEMPTS),
  ],
  [
    'PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS',
    String(parsedEnv.PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS),
  ],
  [
    'PORTFOLIO_SNAPSHOT_QUEUE_METRICS',
    String(parsedEnv.PORTFOLIO_SNAPSHOT_QUEUE_METRICS),
  ],
] as const;

const wasDefaulted = (key: string): boolean => {
  const raw = process.env[key];
  return raw === undefined || raw === null || raw.trim().length === 0;
};

console.info('Configuration boot summary:');
for (const [key, value] of requiredConfigSummary) {
  console.info(`  REQUIRED_CONFIG ${key}=${value}`);
}
for (const key of requiredSecretSummary) {
  console.info(`  REQUIRED_SECRET ${key}=[REDACTED]`);
}
for (const [key, value] of optionalSummary) {
  console.info(
    `  OPTIONAL_CONFIG ${key}=${value} (default=${wasDefaulted(key) ? 'yes' : 'no'})`,
  );
}
if (runtime.nodeEnvWasDefaulted) {
  console.info('  OPTIONAL_CONFIG NODE_ENV=development (default=yes)');
}

const resolvedCorsOrigin = parsedEnv.CORS_ORIGIN
  ? splitCsv(parsedEnv.CORS_ORIGIN)
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081'];

const defaultHorizonUrls = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
} as const;

export const resolveNodeEnv = (): NodeEnvironment => {
  const raw = process.env.NODE_ENV?.trim().toLowerCase();
  if (raw && isNodeEnvironment(raw)) {
    return raw;
  }
  return config.nodeEnv;
};

export const resolveCorsOrigin = (): string | string[] => {
  const runtimeCorsOrigin = process.env.CORS_ORIGIN?.trim();
  if (runtimeCorsOrigin) {
    const origins = splitCsv(runtimeCorsOrigin);
    return origins.length === 1 ? origins[0] : origins;
  }

  if (resolveNodeEnv() === 'production') {
    throw new Error(
      'CORS_ORIGIN must be set in production. Restrict CORS to your frontend URL(s).',
    );
  }

  if (Array.isArray(config.corsOrigin)) {
    const origins = config.corsOrigin as readonly string[];
    return origins.slice();
  }
  return config.corsOrigin as string;
};

export const config = Object.freeze({
  nodeEnv: parsedEnv.NODE_ENV,
  environment: parsedEnv.ENVIRONMENT,
  port: parsedEnv.PORT,
  corsOrigin: Object.freeze(
    resolvedCorsOrigin.length === 1
      ? resolvedCorsOrigin[0]
      : resolvedCorsOrigin,
  ),
  database: Object.freeze({
    host: parsedEnv.DB_HOST,
    port: parsedEnv.DB_PORT,
    username: parsedEnv.DB_USERNAME,
    password: new SecretString(parsedEnv.DB_PASSWORD),
    database: parsedEnv.DB_DATABASE,
    logging: parsedEnv.NODE_ENV === 'development',
  }),
  redis: Object.freeze({
    host: parsedEnv.REDIS_HOST,
    port: parsedEnv.REDIS_PORT,
    url: parsedEnv.REDIS_URL,
  }),
  stellar: Object.freeze({
    network: parsedEnv.STELLAR_NETWORK,
    horizonUrl:
      parsedEnv.STELLAR_HORIZON_URL ||
      defaultHorizonUrls[parsedEnv.STELLAR_NETWORK],
    timeout: parsedEnv.STELLAR_TIMEOUT,
    retryAttempts: parsedEnv.STELLAR_RETRY_ATTEMPTS,
    retryDelay: parsedEnv.STELLAR_RETRY_DELAY,
    serverSecret: new SecretString(parsedEnv.STELLAR_SERVER_SECRET),
  }),
  auth: Object.freeze({
    jwtSecret: new SecretString(parsedEnv.JWT_SECRET),
    jwtExpiresIn: parsedEnv.JWT_EXPIRES_IN,
    domain: parsedEnv.DOMAIN,
  }),
  python: Object.freeze({
    apiUrl: parsedEnv.PYTHON_API_URL,
    serviceUrl: parsedEnv.PYTHON_SERVICE_URL || parsedEnv.PYTHON_API_URL,
    apiKey: parsedEnv.PYTHON_API_KEY,
  }),
  apiKeys: Object.freeze({
    coindesk: parsedEnv.COINDESK_API_KEY,
    webhookSecret: parsedEnv.WEBHOOK_SECRET,
    webhookProviders: parsedEnv.WEBHOOK_PROVIDERS,
    telegramBotToken: parsedEnv.TELEGRAM_BOT_TOKEN,
  }),
  metrics: Object.freeze({
    allowedIps: Object.freeze(splitCsv(parsedEnv.METRICS_ALLOWED_IPS)),
  }),
  logging: Object.freeze({
    enabled: parsedEnv.LOGGING_ENABLED,
    level: parsedEnv.LOGGING_LEVEL ?? 'log',
    includeBody: parsedEnv.LOGGING_INCLUDE_BODY,
    includeResponse: parsedEnv.LOGGING_INCLUDE_RESPONSE,
    includeIP: parsedEnv.LOGGING_INCLUDE_IP,
    includeUserAgent: parsedEnv.LOGGING_INCLUDE_USER_AGENT,
    excludeRoutes: Object.freeze(
      splitCsv(parsedEnv.LOGGING_EXCLUDE_ROUTES).length > 0
        ? splitCsv(parsedEnv.LOGGING_EXCLUDE_ROUTES)
        : ['/health', '/metrics'],
    ),
  }),
  aws: Object.freeze({
    bucketName: parsedEnv.AWS_BUCKET_NAME,
    region: parsedEnv.AWS_REGION,
    accessKeyId: parsedEnv.AWS_ACCESS_KEY_ID,
    secretAccessKey: parsedEnv.AWS_SECRET_ACCESS_KEY,
  }),
  frontend: Object.freeze({
    url: parsedEnv.FRONTEND_URL,
  }),
  featureFlags: Object.freeze({
    useMockTransactions: parsedEnv.USE_MOCK_TRANSACTIONS,
  }),
  portfolioSnapshot: Object.freeze({
    concurrency: parsedEnv.PORTFOLIO_SNAPSHOT_CONCURRENCY,
    batchSize: parsedEnv.PORTFOLIO_SNAPSHOT_BATCH_SIZE,
    attempts: parsedEnv.PORTFOLIO_SNAPSHOT_ATTEMPTS,
    retryDelayMs: parsedEnv.PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS,
    queueMetrics: parsedEnv.PORTFOLIO_SNAPSHOT_QUEUE_METRICS,
  }),
  rateLimit: Object.freeze({
    tracker: Object.freeze({
      useIp: parsedEnv.RATE_LIMIT_TRACK_BY_IP,
      useApiKey: parsedEnv.RATE_LIMIT_TRACK_BY_API_KEY,
      apiKeyHeader: parsedEnv.RATE_LIMIT_API_KEY_HEADER.toLowerCase(),
    }),
    redisUrl: parsedEnv.RATE_LIMIT_REDIS_URL || parsedEnv.REDIS_URL,
    redisNamespace: parsedEnv.RATE_LIMIT_REDIS_NAMESPACE,
    global: Object.freeze({
      limit: resolvedRateLimit.global.limit,
      ttl: resolvedRateLimit.global.ttl,
      blockDuration: resolvedRateLimit.global.blockDuration,
    }),
    auth: Object.freeze({
      limit: resolvedRateLimit.auth.limit,
      ttl: resolvedRateLimit.auth.ttl,
      blockDuration: resolvedRateLimit.auth.blockDuration,
    }),
    portfolioRead: Object.freeze({
      limit: resolvedRateLimit.portfolioRead.limit,
      ttl: resolvedRateLimit.portfolioRead.ttl,
      blockDuration: resolvedRateLimit.portfolioRead.blockDuration,
    }),
    portfolioWrite: Object.freeze({
      limit: resolvedRateLimit.portfolioWrite.limit,
      ttl: resolvedRateLimit.portfolioWrite.ttl,
      blockDuration: resolvedRateLimit.portfolioWrite.blockDuration,
    }),
    watchlistRead: Object.freeze({
      limit: resolvedRateLimit.watchlistRead.limit,
      ttl: resolvedRateLimit.watchlistRead.ttl,
      blockDuration: resolvedRateLimit.watchlistRead.blockDuration,
    }),
    watchlistWrite: Object.freeze({
      limit: resolvedRateLimit.watchlistWrite.limit,
      ttl: resolvedRateLimit.watchlistWrite.ttl,
      blockDuration: resolvedRateLimit.watchlistWrite.blockDuration,
    }),
  }),
});

export type AppConfig = typeof config;
