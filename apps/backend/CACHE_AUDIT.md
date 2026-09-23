# Backend cache inventory and invalidation audit

**Issue:** #1425 — Audit cache invalidation across modules
**Scope:** `apps/backend/src` (NestJS/TypeORM/BullMQ backend)

This document is the source of truth for the backend cache inventory. It records
physical keys, values, TTLs, read/write paths, invalidation triggers,
dependencies, consistency coverage, and the metrics used to operate each
cache. The inventory is intentionally separate from the implementation so a
new cache cannot be added without making its consistency contract visible.

## Cache model and consistency rules

The application cache is Redis through `@nestjs/cache-manager` and Keyv. The
Redis namespace is `lumenpulse`; the cache-manager default is five minutes
(`CACHE_TTL_MS=300000`). Explicit per-entry TTLs below override that default.
The adapter now uses Keyv's non-double-prefixed configuration. Keys written by
the previous namespace/prefix layout, including the old request-URL-derived
HTTP entries, are not read after deployment and remain bounded by their
original Redis TTL while they expire. The `CacheService` facade now owns read-through
invalidation generations,
in-flight fill coalescing, Keyv/SCAN-backed prefix discovery, and cache
telemetry.

A cache read is considered a hit only when both the physical value exists and
its fill belongs to the current invalidation generation. This closes the
read-after-write race where a fetch that started before a write finishes after
the write and puts the old value back **inside the process performing the
write**. Redis deletion is the cross-process propagation mechanism, but the
generation metadata is process-local; deployments with multiple replicas must
use a shared authoritative source (or sticky routing) for process-local stores
such as grants, feature flags, and runtime contract overrides. Sequential and
repeated writes use the same generation boundary; a cache miss followed by a
write is also safe.

### Staleness definition

`cache_staleness_seconds{cache="..."}` is a bounded-family gauge sampled when
a value is read. For `CacheService` keys, the facade tracks the source-load
timestamp for the physical key and combines it with the latest invalidation
boundary; it therefore does not reset when an unrelated key in the same family
is filled. A value loaded by another process has no local timestamp and is
reported conservatively as zero until the next local fill. For the Soroban
caches the source generation is the ledger used to build the simulation; the
two-second ledger/simulation TTL is an additional hard bound. The
`cache_stale_servings_total{cache}` counter is a guardrail for an invalidation
that was observed while an old value was served.

### Hit-rate metrics

`cache_reads_total{cache="<bounded-name>",result="hit|miss"}` is exported for
each application cache family. Operators can calculate a per-cache hit rate
without adding physical keys as labels, for example:

```promql
sum(rate(cache_reads_total{cache="news",result="hit"}[5m]))
/
sum(rate(cache_reads_total{cache="news"}[5m]))
```

The existing aggregate `cache_hits_total`/`cache_misses_total` counters are
retained for compatibility. Feature flags also retain their historical
`feature_flag_cache_hits_total` and
`feature_flag_cache_misses_total` counters. Soroban's dedicated counters are
registered on the same application registry and are listed in its row.

Metric labels never contain account addresses, contract IDs, feature-flag
keys, function XDRs, request URLs, or other user-controlled values. The
physical-key index in `CacheService` is bounded to 10,000 keys, and exact
invalidations retain a bounded generation index; the Soroban simulation map is
bounded to 256 entries; Redis TTLs remain the storage-level bound.

## Inventory

| Cache / module                       | Source and physical key                                                                                                                        | Cached value                                                | TTL                                                    | Read path                                                                   | Write path                                                                 | Invalidation mechanism and trigger                                                                                                                                                                                                                | Dependencies / stale-write risk                                                                                                                                                                                                                                         | Tests                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Account balance read-through         | `CacheService`; `stellar:account:balance:<publicKey>`                                                                                          | `AccountBalancesDto`                                        | `STELLAR_BALANCE_CACHE_TTL`, default 30 s              | `StellarService.getAccountBalances`                                         | `CacheService.getAccountBalanceCached` fetcher                             | `invalidateAccountBalance(publicKey)`; exact-key delete and generation bump. Horizon is the external source, so no backend write currently owns this key.                                                                                         | Account state is external; a local transaction-status write has no account key. TTL is intentional. HTTP response cache below is a second representation.                                                                                                               | `cache/cache-consistency.spec.ts`                                                    |
| Account operations read-through      | `CacheService`; `stellar:account:operations:<publicKey>:<limit>[:<cursor>]`                                                                    | Paginated Horizon operations                                | `STELLAR_OPERATIONS_CACHE_TTL`, default 15 s           | `TransactionService.getTransactionHistory` when mock mode is disabled       | `CacheService.getAccountOperationsCached` fetcher                          | `invalidateAccountOperations(publicKey)`; SCAN/Keyv prefix delete and generation bump for every page/cursor.                                                                                                                                      | External Horizon source; cursor/limit variants must be invalidated together. Horizon operation-fetch errors propagate, so a transient failure cannot be cached as an empty page. The default mock mode bypasses this service cache but the HTTP response cache remains. | `cache/cache-consistency.spec.ts`, `stellar/services/horizon-client.service.spec.ts` |
| Account-balance HTTP response        | Observed interceptor in `StellarController`; `stellar:balances:http:publicKey=<publicKey>`                                                     | Serialized `AccountBalancesDto`                             | 30 s                                                   | `GET /stellar/accounts/:publicKey/balances`                                 | Interceptor after controller response                                      | `invalidateAccountBalance` deletes the service key and the account-specific HTTP prefix together. The HTTP representation still has a short external-source TTL; a future local account write must call the centralized account invalidation API. | Duplicate representation of account-balance data. No current backend write changes a Stellar account, so no confirmed stale write exists.                                                                                                                               | `cache/cache-consistency.spec.ts` (facade), controller coverage                      |
| Transaction-history HTTP response    | Observed interceptor in `StellarController`; `stellar:transactions:http:...`                                                                   | Serialized transaction page                                 | 60 s                                                   | `GET /stellar/transactions`                                                 | Interceptor after controller response                                      | External Horizon source; TTL is intentional. `invalidateAccountOperations` clears the matching account-specific HTTP prefix as well as service-level page keys.                                                                                   | Query parameters are part of the key, preventing cross-page collisions.                                                                                                                                                                                                 | `cache/cache-consistency.spec.ts`, `stellar/stellar.controller.ts`                   |
| Stellar asset discovery response     | Observed interceptor in `StellarController`; `stellar:assets:http:<sorted query>`                                                              | `AssetDiscoveryResponseDto`                                 | 600 s                                                  | `GET /stellar/assets`                                                       | Interceptor after controller response                                      | External Horizon source; TTL is intentional.                                                                                                                                                                                                      | Query parameters are encoded and sorted; no backend write changes Horizon assets.                                                                                                                                                                                       | `cache/cache-consistency.spec.ts`, `stellar/stellar.controller.ts`                   |
| News latest response                 | Observed interceptor in `NewsController`; `news:latest` or `news:latest:<sorted filters>`                                                      | Latest news response                                        | 300 s                                                  | `GET /news` (external provider without filters; local DB with tag/category) | Interceptor after controller response; `NewsService` writes for local rows | `NewsService.create`, `update`, `remove`, and `createOrIgnore` call `invalidateNewsCache`; prefix invalidation removes the base key and all filter variants. External provider changes remain TTL-bounded.                                        | The old fixed `news:latest` key ignored query filters; the key builder fixes that collision. Sentiment updates go through `NewsService.update`.                                                                                                                         | `news/news-cache.spec.ts`, `cache/cache-consistency.spec.ts`                         |
| Contract-read cache                  | `CacheService`; `contract:read:<contractId>:<method>:<base64(JSON args)>`                                                                      | Contract read result                                        | `CacheConfig.contractReadTTL`, default 60 s            | `ProjectsService.fetchOnChainState`                                         | `getContractReadCached` fetcher (currently a placeholder simulation)       | `invalidateContractById`/`invalidateContractRead`; prefix generation and Keyv/SCAN delete. Project-registry and vault-sync writes call this boundary. Contract rotation invalidates the whole `contract:read:` family.                            | Depends on the future on-chain fetcher's project/vault state and contract IDs; current invalidations are conservative while that fetcher is a placeholder.                                                                                                              | `cache/cache-consistency.spec.ts`                                                    |
| Portfolio materialized snapshot      | `MaterializedSnapshotService`; database row keyed one-per-user (`userId`)                                                                      | Portfolio totals, balances, allocation, linked-account flag | No Redis TTL; replaced after each source snapshot      | `PortfolioService.getPortfolioSummary/getAssetAllocation`                   | `MaterializedSnapshotService.upsertForUser` after snapshot persistence     | Upserts replace the row; account link/unlink and failed materialization delete it; the six-hour repair job refreshes every user with source snapshots. Same-user generation checks retry an overlapping read.                                     | Persistent read model, not a Redis value; source snapshot and linked-account changes are the invalidation boundary.                                                                                                                                                     | `portfolio/materialized-snapshot.service.spec.ts`                                    |
| Stellar configuration response       | Observed interceptor in `ConfigController`; `stellar:config` (legacy physical key `stellar-config`)                                            | `StellarConfigResponseDto`                                  | 300 s                                                  | `GET /v1/config/stellar`                                                    | Interceptor after config response                                          | `ConfigService.invalidateCache`; deletes both physical keys plus config/capability/contract-read prefixes. `StellarContractRotationService` calls it after a successful rotation and rollback.                                                    | Contract capability responses and simulation payloads depend on this configuration. Runtime overrides are process-local; multi-replica deployments require a shared configuration source.                                                                               | `config/config.service.spec.ts`, integration contract-rotation coverage              |
| Contract capability catalog          | Observed interceptor in `ContractsController`; `contracts:capabilities` and `contracts:capabilities:<contractId>`                              | Capability catalog/detail                                   | 300 s                                                  | `GET /v1/contracts/capabilities*`                                           | Interceptor after capability response                                      | Included in `ConfigService.invalidateConfigCaches`; contract rotation invalidates catalog and all details.                                                                                                                                        | Depends on runtime contract overrides.                                                                                                                                                                                                                                  | `contracts/contracts.controller.spec.ts`, config invalidation tests                  |
| Exchange-rate read-through           | `ExchangeRatesService` via `CacheService`; `exchange-rates:<FROM>_<TO>` (currency codes uppercased)                                            | Numeric fiat/crypto rate                                    | 24 h                                                   | `getExchangeRate` / `convertCurrency`                                       | `CacheService.getOrSet` after CoinGecko/fallback fetch                     | `invalidateExchangeRate`; explicit operator/source refresh boundary. Fetch failures are not cached.                                                                                                                                               | External provider data intentionally remains cached for 24 h; callers needing current rates must invalidate explicitly.                                                                                                                                                 | `cache/cache-consistency.spec.ts`, `exchange-rates/exchange-rates-cache.spec.ts`     |
| Contributor profile by address       | `ContributorRegistryService` via `CacheService`; `contributor-registry:address:<address>`                                                      | `ContributorResponseDto`                                    | 60 s                                                   | `getContributorByAddress`                                                   | `getOrSet` fetcher (mock store or Soroban simulation)                      | Targeted writes delete address/reputation/nonce and the supplied GitHub key; chain events use broad namespace invalidation so an old handle or an address-only event cannot leave a stale representation.                                         | Registration/profile/reputation events are cross-module writes.                                                                                                                                                                                                         | `contributor-registry/contributor-registry-cache.spec.ts`                            |
| Contributor profile by GitHub        | Same service; `contributor-registry:github:<lowercase-handle>`                                                                                 | `ContributorResponseDto`                                    | 60 s                                                   | `getContributorByGithub`                                                    | `getOrSet` fetcher                                                         | Handle is lowercased in the key; broad chain-event invalidation covers old and new handles.                                                                                                                                                       | Handle changes and address writes must invalidate both representations.                                                                                                                                                                                                 | `contributor-registry/contributor-registry-cache.spec.ts`                            |
| Contributor reputation               | Same service; `contributor-registry:reputation:<address>`                                                                                      | `ReputationResponseDto`                                     | 60 s                                                   | `getReputation`                                                             | `getOrSet` fetcher                                                         | Same contributor invalidation boundary; Soroban reputation/profile/badge events also evict it.                                                                                                                                                    | Reputation can change on-chain without a local DB write.                                                                                                                                                                                                                | `contributor-registry/contributor-registry-cache.spec.ts`                            |
| Contributor registration nonce       | Same service; `contributor-registry:nonce:<address>`                                                                                           | Numeric nonce                                               | 5 s                                                    | `getNonce`                                                                  | `getOrSet` fetcher                                                         | Same contributor invalidation boundary; gasless registration increments the nonce and evicts immediately.                                                                                                                                         | Deliberately short TTL, but registration must not wait for expiry.                                                                                                                                                                                                      | `contributor-registry/contributor-registry-cache.spec.ts`                            |
| Warm grants rounds                   | Warm preloader and `GrantsController`; `warm:grants:rounds`                                                                                    | `RoundDto[]`                                                | `WARM_CACHE_TTL_GRANTS_ROUNDS_MS`, default 5 min       | `GET /grants/rounds` and warm preloader                                     | `WarmCachePreloaderService` and `CacheService.getOrSet`                    | `GrantsService` calls `invalidateWarmGrantsCachesSoon` after every round/pool/eligibility/contribution/finalization/distribution mutation; the generation is advanced synchronously and Redis deletion follows.                                   | Depends on the in-memory authoritative `GrantsService` store.                                                                                                                                                                                                           | `grants/grants-cache.spec.ts`, `cache/cache-consistency.spec.ts`                     |
| Warm grants leaderboard              | Warm preloader and `GrantsController`; `warm:grants:leaderboard:round=<roundId>&page=...&limit=...&topN=...` (legacy base key is also evicted) | `LeaderboardResponseDto`                                    | `WARM_CACHE_TTL_GRANTS_LEADERBOARD_MS`, default 10 min | `GET /grants/leaderboard` and warm preloader                                | Warm preloader / `CacheService.getOrSet`                                   | Every key includes `roundId`; grants invalidation advances both warm families before asynchronous Redis deletion.                                                                                                                                 | Depends on contributions, pool, eligibility, finalization and distribution writes. The in-memory grant store is authoritative only within one process.                                                                                                                  | `grants/grants-cache.spec.ts`, `cache/cache-consistency.spec.ts`                     |
| Feature-flag evaluation              | `FeatureFlagsService`; in-memory `Map<flagKey, CacheEntry>`                                                                                    | `FeatureFlag` or negative `null`                            | 30 s                                                   | `getFlag` / `isEnabled`                                                     | `onModuleInit` refresh, DB miss, and post-save upsert replacement          | `upsert` and `remove` mutate the entry at the write boundary; per-key write locks serialize sequential/repeated writes. External DB writers rely on the 30 s TTL.                                                                                 | No cross-module dependent cache; the previous implementation had no write serialization.                                                                                                                                                                                | `feature-flags/feature-flags.service.spec.ts`                                        |
| Latest Soroban ledger                | `SorobanRpcClientService`; in-memory `cachedLedger`                                                                                            | `{ sequence, expiresAt, loadedAt }`                         | 2 s                                                    | `getLatestLedgerSequence`                                                   | RPC `getLatestLedger` response                                             | A changed sequence or explicit invalidation clears simulation entries; every submission attempt and contract rotation call `invalidateSimulationCache`.                                                                                           | Simulation keys include the ledger sequence, so ledger changes are a source-version boundary.                                                                                                                                                                           | `stellar/services/soroban-rpc-client.service.spec.ts`                                |
| Read-only Soroban simulation         | `SorobanRpcClientService`; in-memory `Map<funcXdr>_<ledgerSequence, {response,cachedAt,ledgerLoadedAt}>`                                       | `SimulateTransactionResponse`                               | 2 s, plus 256-entry LRU bound                          | Read-only, single-operation `simulateTransaction`; configurable off         | Successful read-only RPC response                                          | Ledger change, every submission attempt, and contract rotation clear the map; a generation check discards an in-flight pre-write fill. Expired and oldest entries are evicted.                                                                    | Any contract state write through the shared RPC client invalidates dependent read simulations; external writers are bounded by the two-second ledger TTL.                                                                                                               | `stellar/services/soroban-rpc-client.service.spec.ts`                                |
| Price-alert evaluation deduplication | `PriceAlertEvaluationService`; per-evaluation `Map<symbol, price>`                                                                             | One fetched price per unique symbol                         | Until one `doEvaluate` call ends                       | Evaluation loop                                                             | Fetches each unique symbol once                                            | No persistent invalidation is needed; the map is discarded after the batch.                                                                                                                                                                       | It is request/batch memoization, not a reusable cache.                                                                                                                                                                                                                  | `price-alert` service tests cover evaluation behavior                                |

## Write-to-cache dependency matrix

| Write operation                                                              | Direct cache                                     | Dependent caches invalidated                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NewsService.create/update/remove/createOrIgnore`                            | News response                                    | All filtered news variants; sentiment updates inherit the same boundary.                                                                          |
| `FeatureFlagsService.upsert/remove`                                          | Flag evaluation map                              | No dependent read cache; post-save replacement/eviction is serialized per key.                                                                    |
| Grant round/pool/eligibility/contribution/finalization/distribution mutation | Warm grants rounds/leaderboard                   | Both warm cache families, including parameterized leaderboard pages.                                                                              |
| `StellarContractRotationService.rotateContractIds`                           | Runtime config overrides                         | Config response, capability catalog/details, all generic contract reads, and Soroban simulation/ledger caches. Rollback repeats the invalidation. |
| `UsersService.addStellarAccount/removeStellarAccount`                        | Linked-account relation                          | Deletes the affected user's materialized portfolio row so `hasLinkedAccount` and balances cannot remain stale.                                    |
| Project-registry event upsert                                                | Project registry row                             | Project contract-read cache for that project.                                                                                                     |
| Crowdfund sync/register-vault write                                          | Vault/project synchronization state              | Project contract-read cache for the affected project.                                                                                             |
| Contributor mock/real registration or contributor event                      | Contributor address/GitHub/reputation/nonce keys | All contributor representations; event schemas without a subject evict the bounded contributor namespace.                                         |
| `SorobanRpcClientService.sendTransaction` (every attempt)                    | Submitted transaction                            | Read-only simulation and latest-ledger caches; generation guards discard in-flight pre-write fills.                                               |
| Scheduled Soroban indexer event insert                                       | Encoded chain event                              | Conservatively invalidates contributor namespaces, contract-read family, or warm grant families based on event type.                              |
| External Horizon/CoinGecko/news-provider state change                        | No local write path                              | Intentional TTL expiry; explicit invalidation APIs exist for operator/source refresh.                                                             |

## Metrics

The following metric families are available on the application Prometheus
registry, including the Soroban families:

- `cache_reads_total{cache,result}` — per-cache hit/miss counters; hit rate is
  derived from this family.
- `cache_staleness_seconds{cache}` — current source-generation age described
  above.
- `cache_invalidations_total{cache,result}` — successful and failed
  invalidation attempts.
- `cache_stale_servings_total{cache}` — should remain zero when generation
  guards work; useful as an alert signal.
- `cache_fill_race_prevented_total{cache}` — fills discarded because a write
  invalidated the key while the source fetch was in flight.
- `soroban_ledger_cache_hits_total`, `soroban_ledger_cache_misses_total`,
  `soroban_ledger_cache_staleness_seconds`.
- `soroban_simulation_cache_hits_total`,
  `soroban_simulation_cache_misses_total`,
  `soroban_simulation_cache_staleness_seconds`.

The feature-flag service continues to expose its historical evaluation
counters and latency histogram. Warm-cache preload counters remain unchanged;
warm read hits/misses now flow through `cache_reads_total` when a controller
consumes a warmed key.

## Tests and validation

Read-after-write coverage is split by cache family:

- `src/cache/cache-consistency.spec.ts`: account balances, paginated account
  operations, HTTP transaction keys, contract reads, news, exchange rates,
  contributor keys, warm keys, repeated writes, in-flight read/fill races, and
  per-cache metrics.
- `src/cache/cache-keyv.spec.ts`: real cache-manager/Keyv namespace and
  SCAN-backed prefix invalidation.
- `src/stellar/services/horizon-client.service.spec.ts`: transient operation
  fetch failures propagate instead of becoming cacheable empty pages.
- `src/exchange-rates/exchange-rates-cache.spec.ts`: canonical currency keys
  and an owner-path read-after-invalidation check.
- `src/portfolio/materialized-snapshot.service.spec.ts`: materialized-row
  reads, replacement, deletion, and allocation behavior.
- `src/grants/grants-cache.spec.ts`: warm rounds and round-isolated leaderboard
  reads after writes.
- `src/news/news-cache.spec.ts`: news update/remove invalidation.
- `src/contributor-registry/contributor-registry-cache.spec.ts`: address,
  GitHub, reputation, and nonce dependency invalidation.
- `src/soroban-events/soroban-events-cache.spec.ts`: handle-only contributor
  events conservatively evict every contributor representation.
- `src/feature-flags/feature-flags.service.spec.ts`: repeated upsert and
  remove consistency.
- `src/stellar/services/soroban-rpc-client.service.spec.ts`: simulation hit,
  state-changing invalidation, and refresh after submission.
- Existing controller, cache, contract, config, and stellar integration suites
  cover the HTTP cache decorators and rotation path.

Validation commands used for this change (the repository has unrelated
pre-existing formatting findings outside the changed files):

```bash
cd apps/backend
npm run build
npm test -- --runInBand
npx tsc --noEmit -p tsconfig.build.json
npm run migration:check
npx eslint <changed-and-added-typescript-files>
npx prettier --check <changed-and-added-files>
```

## Non-cache stores deliberately excluded from cache metrics

The audit also searched for every `Map`, Redis adapter, TTL, and in-memory
store. The following are authoritative state or security/operational stores,
not reusable data caches, so adding cache hit/staleness labels to them would
be misleading:

- `AuthService.challengeStore`: SEP-10 challenge, 5-minute expiry, consumed or
  deleted on verification/cleanup.
- `WebhookVerificationGuard.seenNonces`: replay-protection set, timestamp
  tolerance TTL, periodic purge.
- `RateLimitStorageService`: throttling counters in Keyv/Redis or an in-memory
  Keyv fallback, with route-limit/block expiry; not a source-value cache.
- `BurstRule` fraud detection: Redis sorted-set rolling window
  `fraud:contributions:burst:<roundId>:<contributor>`; writes trim by score,
  refresh a 300-second expiry, and reads use `ZCARD`; it is abuse-control
  state, not a reusable domain cache.
- `CacheService.checkHealth`: temporary `health:redis:<timestamp>` key with a
  one-second TTL, deleted immediately after the probe; it is a dependency
  health check, not a domain cache.
- `IdempotencyService` records: database-backed mutation-response replay
  store (`key`, method, route, request hash, response body/status), 24-hour
  retention with a 60-second in-progress lease. `acquire` and
  `waitForCompletion` read it; `complete` writes it; `release` and the
  scheduler delete expired/reclaimed records. It intentionally replays the
  exact response for an idempotent retry rather than caching mutable domain
  data, so it has no dependent domain-cache invalidation or cache hit-rate
  metric. Existing `idempotency/idempotency.service.spec.ts` covers lease,
  completion, mismatch, and cleanup behavior.
- `PortfolioSnapshotProgressStore`: Redis hash `portfolio:snapshot:batch:<batchId>`
  for batch progress; writes refresh a seven-day sliding operational TTL, and
  reads are status reads rather than cached domain data.
- `WarmCacheRegistry.routes`: route metadata, not cached values.
- BullMQ queues (`suspicious-contribution`, `moderation-events`, `stellar-sync`,
  `soroban-events`, `crowdfund-vault-sync`, and `portfolio-snapshot`) are
  operational Redis state with configured retention/retry policies, not
  read-through caches.
- `AuthService` password-reset/refresh-token rows (one-hour and 30-day logical
  expiries), price-alert cooldown rows, and `PriceAlertEvaluationService`'s
  per-batch price memo map are security/scheduling or request-scoped state.
- `ContributorFeedService`, demo bootstrap state, runtime contract overrides,
  warm-preloader last-run/report fields, and bot/webhook provider registries
  are process-local metadata or authoritative state.
- `ContributorRegistryService.mock*` maps, `VerificationService` maps,
  `CrowdfundService.projects`, and `GrantsService.rounds`: authoritative
  in-process domain stores (the last one is intentionally the backing store
  for warm grants).
- Soroban/crowdfund synchronization cursors, event ledgers, dead-letter rows,
  outbox rows, and audit rows: durable workflow/compliance state, not cached
  read models.
- `ReconciliationService` per-run asset lookup maps and other request-local
  lookup maps: temporary working state, not reusable caches.
- `MetricsService` registry maps and bot/provider registries: metric/config
  metadata, not data caches.

A TTL or `Map` in these components is therefore documented above as a
non-cache store rather than assigned a misleading hit-rate metric.
