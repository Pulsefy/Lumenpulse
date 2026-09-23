/**
 * Stable identifiers and key builders for backend caches.
 *
 * Keep these values independent of user input.  They are used for bounded
 * metric labels and make it possible for writers to invalidate every cache
 * representation of a value without relying on a framework-generated key.
 */

export const NEWS_CACHE_KEY = 'news:latest';
export const NEWS_CACHE_PREFIX = `${NEWS_CACHE_KEY}:`;
export const STELLAR_ASSETS_CACHE_PREFIX = 'stellar:assets';
export const STELLAR_ACCOUNT_BALANCE_PREFIX = 'stellar:account:balance';
export const STELLAR_ACCOUNT_OPERATIONS_PREFIX = 'stellar:account:operations';
export const CONTRACT_READ_PREFIX = 'contract:read';
export const EXCHANGE_RATE_CACHE_PREFIX = 'exchange-rates';
export const CONTRIBUTOR_ADDRESS_CACHE_PREFIX = 'contributor-registry:address';
export const CONTRIBUTOR_GITHUB_CACHE_PREFIX = 'contributor-registry:github';
export const CONTRIBUTOR_REPUTATION_CACHE_PREFIX =
  'contributor-registry:reputation';
export const CONTRIBUTOR_NONCE_CACHE_PREFIX = 'contributor-registry:nonce';

export const STELLAR_CONFIG_CACHE_KEY = 'stellar:config';
export const LEGACY_STELLAR_CONFIG_CACHE_KEY = 'stellar-config';
export const CONTRACT_CAPABILITIES_CACHE_KEY = 'contracts:capabilities';
export const CONTRACT_CAPABILITIES_CACHE_PREFIX = `${CONTRACT_CAPABILITIES_CACHE_KEY}:`;
export const STELLAR_ASSETS_HTTP_CACHE_PREFIX = 'stellar:assets:http:';
export const STELLAR_BALANCES_HTTP_CACHE_PREFIX = 'stellar:balances:http:';
export const STELLAR_TRANSACTIONS_HTTP_CACHE_PREFIX =
  'stellar:transactions:http:';

export const WARM_CACHE_KEY_GRANTS_ROUNDS = 'warm:grants:rounds';
export const WARM_CACHE_KEY_GRANTS_LEADERBOARD = 'warm:grants:leaderboard';
export const WARM_CACHE_KEY_DASHBOARD_SUMMARY = 'warm:dashboard:summary';
export const WARM_CACHE_PREFIX = 'warm:';

export const CACHE_NAMES = {
  ACCOUNT_BALANCE: 'stellar_account_balance',
  ACCOUNT_OPERATIONS: 'stellar_account_operations',
  ASSETS: 'stellar_assets',
  CONFIG: 'stellar_config',
  CONTRACT_CAPABILITIES: 'contract_capabilities',
  CONTRACT_READ: 'contract_read',
  CONTRIBUTOR_ADDRESS: 'contributor_address',
  CONTRIBUTOR_GITHUB: 'contributor_github',
  CONTRIBUTOR_NONCE: 'contributor_nonce',
  CONTRIBUTOR_REPUTATION: 'contributor_reputation',
  EXCHANGE_RATE: 'exchange_rate',
  FEATURE_FLAG: 'feature_flag',
  NEWS: 'news',
  PORTFOLIO_MATERIALIZED: 'portfolio_materialized',
  SIMULATION: 'soroban_simulation',
  LEDGER: 'soroban_ledger',
  WARM_GRANTS_LEADERBOARD: 'warm_grants_leaderboard',
  WARM_GRANTS_ROUNDS: 'warm_grants_rounds',
  OTHER: 'other',
} as const;

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES];

const CACHE_NAME_VALUES = new Set<string>(Object.values(CACHE_NAMES));

export function asCacheName(value: string): CacheName {
  return CACHE_NAME_VALUES.has(value)
    ? (value as CacheName)
    : CACHE_NAMES.OTHER;
}

/**
 * Map a physical key to a bounded metric label.  Never return a key fragment,
 * account address, contract ID, or other user-controlled value as a label.
 */
export function classifyCacheKey(key: string): CacheName {
  // Prefix invalidation callers often pass a trailing colon. Normalize it so
  // the bounded family label is the same for a prefix and its physical keys.
  const normalized = key.endsWith(':') ? key.slice(0, -1) : key;
  const matches = (prefix: string): boolean =>
    key.startsWith(prefix) || normalized.startsWith(prefix);
  const equals = (value: string): boolean =>
    key === value || normalized === value;

  if (
    equals(WARM_CACHE_KEY_GRANTS_ROUNDS) ||
    matches(`${WARM_CACHE_KEY_GRANTS_ROUNDS}:`)
  ) {
    return CACHE_NAMES.WARM_GRANTS_ROUNDS;
  }
  if (
    equals(WARM_CACHE_KEY_GRANTS_LEADERBOARD) ||
    matches(`${WARM_CACHE_KEY_GRANTS_LEADERBOARD}:`)
  ) {
    return CACHE_NAMES.WARM_GRANTS_LEADERBOARD;
  }
  if (equals(NEWS_CACHE_KEY) || matches(NEWS_CACHE_PREFIX)) {
    return CACHE_NAMES.NEWS;
  }
  if (
    equals(STELLAR_CONFIG_CACHE_KEY) ||
    matches(`${STELLAR_CONFIG_CACHE_KEY}:`) ||
    equals(LEGACY_STELLAR_CONFIG_CACHE_KEY)
  ) {
    return CACHE_NAMES.CONFIG;
  }
  if (
    equals(CONTRACT_CAPABILITIES_CACHE_KEY) ||
    matches(CONTRACT_CAPABILITIES_CACHE_PREFIX)
  ) {
    return CACHE_NAMES.CONTRACT_CAPABILITIES;
  }
  if (matches(STELLAR_BALANCES_HTTP_CACHE_PREFIX)) {
    return CACHE_NAMES.ACCOUNT_BALANCE;
  }
  if (matches(STELLAR_TRANSACTIONS_HTTP_CACHE_PREFIX)) {
    return CACHE_NAMES.ACCOUNT_OPERATIONS;
  }
  if (matches(STELLAR_ASSETS_HTTP_CACHE_PREFIX)) {
    return CACHE_NAMES.ASSETS;
  }
  if (matches(`${STELLAR_ACCOUNT_BALANCE_PREFIX}:`)) {
    return CACHE_NAMES.ACCOUNT_BALANCE;
  }
  if (matches(`${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:`)) {
    return CACHE_NAMES.ACCOUNT_OPERATIONS;
  }
  if (matches(`${CONTRACT_READ_PREFIX}:`)) {
    return CACHE_NAMES.CONTRACT_READ;
  }
  if (matches(`${EXCHANGE_RATE_CACHE_PREFIX}:`)) {
    return CACHE_NAMES.EXCHANGE_RATE;
  }
  if (matches(`${CONTRIBUTOR_ADDRESS_CACHE_PREFIX}:`)) {
    return CACHE_NAMES.CONTRIBUTOR_ADDRESS;
  }
  if (matches(`${CONTRIBUTOR_GITHUB_CACHE_PREFIX}:`)) {
    return CACHE_NAMES.CONTRIBUTOR_GITHUB;
  }
  if (matches(`${CONTRIBUTOR_REPUTATION_CACHE_PREFIX}:`)) {
    return CACHE_NAMES.CONTRIBUTOR_REPUTATION;
  }
  if (matches(`${CONTRIBUTOR_NONCE_CACHE_PREFIX}:`)) {
    return CACHE_NAMES.CONTRIBUTOR_NONCE;
  }
  if (matches('feature-flag:')) return CACHE_NAMES.FEATURE_FLAG;
  if (matches('soroban:simulation:')) return CACHE_NAMES.SIMULATION;
  if (matches('portfolio:materialized')) {
    return CACHE_NAMES.PORTFOLIO_MATERIALIZED;
  }
  if (matches('soroban:ledger')) return CACHE_NAMES.LEDGER;
  if (matches('stellar:assets')) {
    return CACHE_NAMES.ASSETS;
  }
  return CACHE_NAMES.OTHER;
}

/** Build a deterministic, bounded-cardinality metric/cache prefix key. */
export function buildStellarHttpCacheKey(
  kind: 'balances' | 'transactions' | 'assets',
  values: Record<string, string | number | undefined>,
): string {
  const prefix =
    kind === 'balances'
      ? STELLAR_BALANCES_HTTP_CACHE_PREFIX
      : kind === 'transactions'
        ? STELLAR_TRANSACTIONS_HTTP_CACHE_PREFIX
        : STELLAR_ASSETS_HTTP_CACHE_PREFIX;
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined && value !== '',
  );
  entries.sort(([left], [right]) => left.localeCompare(right));
  if (kind === 'transactions' && values.publicKey !== undefined) {
    const publicKeyIndex = entries.findIndex(([key]) => key === 'publicKey');
    if (publicKeyIndex > 0) {
      const [publicKeyEntry] = entries.splice(publicKeyIndex, 1);
      entries.unshift(publicKeyEntry);
    }
  }
  const encoded = entries
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return encoded ? `${prefix}${encoded}` : prefix;
}

/** Build a cache key for the latest-news response, including all filters. */
export function buildNewsCacheKey(values: {
  limit?: string | number;
  lang?: string;
  tag?: string;
  category?: string;
}): string {
  const encoded = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return encoded ? `${NEWS_CACHE_PREFIX}${encoded}` : NEWS_CACHE_KEY;
}

export function buildContractCapabilitiesCacheKey(contractId?: string): string {
  return contractId
    ? `${CONTRACT_CAPABILITIES_CACHE_PREFIX}${contractId}`
    : CONTRACT_CAPABILITIES_CACHE_KEY;
}

export function buildWarmLeaderboardCacheKey(values: {
  roundId: number;
  page?: number;
  limit?: number;
  topN?: number;
}): string {
  const parts = [
    `round=${encodeURIComponent(String(values.roundId))}`,
    `page=${encodeURIComponent(String(values.page ?? 1))}`,
    `limit=${encodeURIComponent(String(values.limit ?? 10))}`,
  ];
  if (values.topN !== undefined) {
    parts.push(`topN=${encodeURIComponent(String(values.topN))}`);
  }
  return `${WARM_CACHE_KEY_GRANTS_LEADERBOARD}:${parts.join('&')}`;
}

export const DEFAULT_TTLS = {
  accountBalance: 30_000,
  accountOperations: 15_000,
  assets: 600_000,
  config: 300_000,
  contractCapabilities: 300_000,
  contractRead: 60_000,
  contributor: 60_000,
  contributorNonce: 5_000,
  exchangeRate: 24 * 60 * 60 * 1_000,
  featureFlag: 30_000,
  news: 300_000,
  simulation: 2_000,
  warmGrantsRounds: 5 * 60 * 1_000,
  warmGrantsLeaderboard: 10 * 60 * 1_000,
} as const;
