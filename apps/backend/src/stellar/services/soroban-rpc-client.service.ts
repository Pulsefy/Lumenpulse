import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  rpc,
  Account,
  Address,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Transaction,
} from '@stellar/stellar-sdk';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { config } from '../../lib/config';
import { RequestContextService } from '../../common/services/request-context.service';
import { MetricsService } from '../../metrics/metrics.service';
import { CACHE_NAMES } from '../../cache/cache.constants';

export enum SorobanErrorCode {
  TIMEOUT = 'SOROBAN_TIMEOUT',
  SIMULATION_FAILED = 'SOROBAN_SIMULATION_FAILED',
  ACCOUNT_NOT_FOUND = 'SOROBAN_ACCOUNT_NOT_FOUND',
  SUBMISSION_FAILED = 'SOROBAN_SUBMISSION_FAILED',
  NETWORK_ERROR = 'SOROBAN_NETWORK_ERROR',
  MAX_RETRIES_EXCEEDED = 'SOROBAN_MAX_RETRIES_EXCEEDED',
}

export class SorobanRpcError extends Error {
  constructor(
    public readonly code: SorobanErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SorobanRpcError';
  }
}

export interface SorobanClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  isReadOnly?: boolean;
}

type SimulationTraceLevel = 'off' | 'summary' | 'verbose';

interface ContractInvocationSummary {
  contract: string;
  method: string;
  operationCount: number;
  operationTypes: string[];
  source?: string;
}

interface SimulationSummary {
  status: 'failed';
  error: string;
  eventCount?: number;
  hasTransactionData?: boolean;
  hasRestorePreamble?: boolean;
  minResourceFee?: string;
  cost?: {
    cpuInsns?: string;
    memBytes?: string;
  };
}

interface SimulationCacheEntry {
  response: rpc.Api.SimulateTransactionResponse;
  cachedAt: number;
  ledgerLoadedAt: number;
  ledgerSequence: number;
}

const SIMULATION_CACHE_TTL_MS = 2_000;
const MAX_SIMULATION_CACHE_ENTRIES = 256;
const LEDGER_CACHE_TTL_MS = 2_000;

const DEFAULT_OPTIONS: Required<SorobanClientOptions> = {
  timeoutMs: config.stellar.timeout ?? 30_000,
  maxRetries: 3,
  initialBackoffMs: 500,
  isReadOnly: false,
};

@Injectable()
export class SorobanRpcClientService {
  private readonly logger = new Logger(SorobanRpcClientService.name);
  private readonly server: rpc.Server;

  // Prometheus metrics
  private readonly rpcLatency: Histogram;
  private readonly rpcErrors: Counter;
  private readonly rpcRequests: Counter;

  // Read-only simulation cache metrics.  Labels are fixed and contain no
  // contract IDs, function XDRs, or transaction data.
  private readonly simulationCacheHits: Counter;
  private readonly simulationCacheMisses: Counter;
  private readonly simulationCacheStaleness: Gauge;
  private readonly ledgerCacheHits: Counter;
  private readonly ledgerCacheMisses: Counter;
  private readonly ledgerCacheStaleness: Gauge;

  constructor(
    private readonly requestContextService: RequestContextService,
    @Optional() private readonly registry?: Registry,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    const rpcUrl =
      config.stellar.sorobanRpcUrl ??
      (config.stellar.network === 'mainnet'
        ? 'https://soroban.stellar.org'
        : 'https://soroban-testnet.stellar.org');

    this.server = new rpc.Server(rpcUrl, {
      timeout: DEFAULT_OPTIONS.timeoutMs,
      allowHttp: rpcUrl.startsWith('http://'),
    });

    const reg = this.registry ?? new Registry();

    this.rpcLatency = new Histogram({
      name: 'soroban_rpc_latency_ms',
      help: 'Soroban RPC call latency in milliseconds',
      labelNames: ['method', 'status'],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000],
      registers: [reg],
    });

    this.rpcErrors = new Counter({
      name: 'soroban_rpc_errors_total',
      help: 'Total Soroban RPC errors by code',
      labelNames: ['code'],
      registers: [reg],
    });

    this.rpcRequests = new Counter({
      name: 'soroban_rpc_requests_total',
      help: 'Total Soroban RPC requests by method',
      labelNames: ['method'],
      registers: [reg],
    });

    this.simulationCacheHits = new Counter({
      name: 'soroban_simulation_cache_hits_total',
      help: 'Read-only Soroban simulation cache hits',
      registers: [reg],
    });
    this.simulationCacheMisses = new Counter({
      name: 'soroban_simulation_cache_misses_total',
      help: 'Read-only Soroban simulation cache misses',
      registers: [reg],
    });
    this.simulationCacheStaleness = new Gauge({
      name: 'soroban_simulation_cache_staleness_seconds',
      help: 'Seconds since the cached simulation source ledger was loaded; bounded by the ledger/simulation TTL',
      registers: [reg],
    });
    this.ledgerCacheHits = new Counter({
      name: 'soroban_ledger_cache_hits_total',
      help: 'Latest-ledger cache hits',
      registers: [reg],
    });
    this.ledgerCacheMisses = new Counter({
      name: 'soroban_ledger_cache_misses_total',
      help: 'Latest-ledger cache misses',
      registers: [reg],
    });
    this.ledgerCacheStaleness = new Gauge({
      name: 'soroban_ledger_cache_staleness_seconds',
      help: 'Seconds since the latest ledger was fetched from Soroban RPC',
      registers: [reg],
    });
  }

  /** Fetch an account from the RPC with retries */
  async getAccount(
    publicKey: string,
    opts?: SorobanClientOptions,
  ): Promise<Account> {
    return this.withRetry('getAccount', opts, async () => {
      const account = await this.server.getAccount(publicKey);
      return account;
    });
  }

  private cachedLedger = { sequence: 0, expiresAt: 0, loadedAt: 0 };
  private readonly simulationCache = new Map<string, SimulationCacheEntry>();
  private simulationGeneration = 0;
  private ledgerGeneration = 0;

  private async getLatestLedgerSequence(): Promise<number> {
    const now = Date.now();
    if (now < this.cachedLedger.expiresAt) {
      const staleness = Math.max(0, (now - this.cachedLedger.loadedAt) / 1_000);
      this.ledgerCacheHits.inc();
      this.ledgerCacheStaleness.set(staleness);
      this.recordSharedCacheRead(CACHE_NAMES.LEDGER, 'hit', staleness);
      return this.cachedLedger.sequence;
    }

    this.ledgerCacheMisses.inc();
    this.recordSharedCacheRead(CACHE_NAMES.LEDGER, 'miss', 0);
    let response: rpc.Api.GetLatestLedgerResponse | undefined;
    let acceptedGeneration: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generationAtStart = this.ledgerGeneration;
      response = await this.server.getLatestLedger();
      // A submission/rotation may have invalidated the ledger while the RPC
      // request was in flight. Do not let that old response repopulate the
      // cache; retry once against the new generation when possible.
      if (generationAtStart !== this.ledgerGeneration) continue;
      acceptedGeneration = generationAtStart;
      break;
    }

    // If writes continued throughout the bounded retry, do not let the
    // caller use this response as a cache key. The surrounding simulation
    // path treats this as an uncacheable load and calls the RPC directly.
    if (!response || acceptedGeneration === undefined) {
      throw new Error('Ledger changed while loading');
    }
    if (
      this.cachedLedger.sequence !== 0 &&
      this.cachedLedger.sequence !== response.sequence
    ) {
      this.clearSimulationEntries();
    }
    if (acceptedGeneration === this.ledgerGeneration) {
      this.cachedLedger = {
        sequence: response.sequence,
        expiresAt: Date.now() + LEDGER_CACHE_TTL_MS,
        loadedAt: Date.now(),
      };
      this.ledgerCacheStaleness.set(0);
      this.setSharedCacheStaleness(CACHE_NAMES.LEDGER);
    }
    return response.sequence;
  }

  /**
   * Clear all read-only simulation state after a state-changing transaction,
   * contract rotation, or an explicit operator invalidation.
   */
  invalidateSimulationCache(): void {
    this.ledgerGeneration += 1;
    this.clearSimulationEntries();
    this.cachedLedger = { sequence: 0, expiresAt: 0, loadedAt: 0 };
    this.simulationCacheStaleness.set(0);
    this.ledgerCacheStaleness.set(0);
    this.setSharedCacheStaleness(CACHE_NAMES.SIMULATION);
    this.setSharedCacheStaleness(CACHE_NAMES.LEDGER);
  }

  private clearSimulationEntries(): void {
    this.simulationGeneration += 1;
    this.simulationCache.clear();
    this.simulationCacheStaleness.set(0);
    this.setSharedCacheStaleness(CACHE_NAMES.SIMULATION);
  }

  /** Simulate a transaction with retries */
  async simulateTransaction(
    tx: Parameters<rpc.Server['simulateTransaction']>[0] | Transaction | string,
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    const isReadOnly = opts?.isReadOnly ?? false;
    const cacheEnabled = config.stellar.simulationCacheEnabled !== false;

    let cacheKey: string | undefined;
    let expectedLedgerSequence: number | undefined;

    if (isReadOnly && cacheEnabled) {
      try {
        const record = this.asRecord(tx);
        const operations = Array.isArray(record.operations)
          ? record.operations
          : [];
        if (operations.length === 1) {
          const op = this.asRecord(operations[0]);
          const hostFunction = op.func ?? op.hostFunction;
          if (
            hostFunction &&
            typeof hostFunction === 'object' &&
            'toXDR' in hostFunction
          ) {
            const funcXdr = (
              hostFunction as { toXDR: (encoding: string) => string }
            ).toXDR('base64');
            expectedLedgerSequence = await this.getLatestLedgerSequence();
            cacheKey = `${this.getSimulationFingerprint(tx)}_${funcXdr}_${expectedLedgerSequence}`;

            const now = Date.now();
            const cached = this.simulationCache.get(cacheKey);
            if (cached && now - cached.cachedAt <= SIMULATION_CACHE_TTL_MS) {
              // Refresh LRU position without changing the source version.
              this.simulationCache.delete(cacheKey);
              this.simulationCache.set(cacheKey, cached);
              const staleness = Math.max(
                0,
                (Date.now() - cached.ledgerLoadedAt) / 1_000,
              );
              this.simulationCacheHits.inc();
              this.simulationCacheStaleness.set(staleness);
              this.recordSharedCacheRead(
                CACHE_NAMES.SIMULATION,
                'hit',
                staleness,
              );
              return cached.response;
            }
            if (cached) this.simulationCache.delete(cacheKey);
            this.simulationCacheMisses.inc();
            this.recordSharedCacheRead(CACHE_NAMES.SIMULATION, 'miss', 0);
          }
        }
      } catch (err: unknown) {
        this.logger.debug(
          `Failed to compute simulation cache key: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const generationAtStart = cacheKey ? this.simulationGeneration : undefined;

    return this.withRetry('simulateTransaction', opts, async () => {
      const result = await this.server.simulateTransaction(
        tx as Parameters<rpc.Server['simulateTransaction']>[0],
      );
      if (rpc.Api.isSimulationError(result)) {
        this.logFailedSimulationTrace(tx, result);
        throw new SorobanRpcError(
          SorobanErrorCode.SIMULATION_FAILED,
          `Simulation failed: ${result.error ?? 'Unknown error'}`,
          result,
        );
      }

      if (
        cacheKey &&
        generationAtStart === this.simulationGeneration &&
        result.latestLedger === expectedLedgerSequence
      ) {
        this.simulationCache.set(cacheKey, {
          response: result,
          cachedAt: Date.now(),
          ledgerLoadedAt: this.cachedLedger.loadedAt,
          ledgerSequence: expectedLedgerSequence,
        });
        while (this.simulationCache.size > MAX_SIMULATION_CACHE_ENTRIES) {
          const oldestKey = this.simulationCache.keys().next().value as
            | string
            | undefined;
          if (oldestKey === undefined) break;
          this.simulationCache.delete(oldestKey);
        }
        this.simulationCacheStaleness.set(0);
        this.setSharedCacheStaleness(CACHE_NAMES.SIMULATION);
      }

      return result;
    });
  }

  /** Send a transaction with retries */
  async sendTransaction(
    tx: Parameters<rpc.Server['sendTransaction']>[0] | Transaction | string,
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SendTransactionResponse> {
    return this.withRetry('sendTransaction', opts, async () => {
      try {
        const result = await this.server.sendTransaction(
          tx as Parameters<rpc.Server['sendTransaction']>[0],
        );
        if (result.status === 'ERROR') {
          throw new SorobanRpcError(
            SorobanErrorCode.SUBMISSION_FAILED,
            `Transaction submission failed: ${JSON.stringify(result.errorResult ?? 'Unknown')}`,
          );
        }
        return result;
      } finally {
        // A submission can change state even when the response is lost or
        // reports an error. Clearing on every attempt is the safe direction.
        this.invalidateSimulationCache();
      }
    });
  }

  /** Poll for transaction status until finalized */
  async getTransaction(
    hash: string,
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.GetTransactionResponse> {
    return this.withRetry('getTransaction', opts, async () => {
      return this.server.getTransaction(hash);
    });
  }

  /** Simulate a simple read-only contract method call */
  async simulateContractRead(
    sourceAccountId: string,
    sourceSequence: string,
    contractId: string,
    method: string,
    networkPassphrase: string,
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    const tx = new TransactionBuilder(
      new Account(sourceAccountId, sourceSequence),
      { fee: BASE_FEE, networkPassphrase },
    )
      .addOperation(new Contract(contractId).call(method))
      .setTimeout(30)
      .build();

    return this.simulateTransaction(tx, { ...opts, isReadOnly: true });
  }

  /** Expose the raw server for advanced usage */
  get rawServer(): rpc.Server {
    return this.server;
  }

  private async withRetry<T>(
    method: string,
    opts: SorobanClientOptions | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const { maxRetries, initialBackoffMs, timeoutMs } = {
      ...DEFAULT_OPTIONS,
      ...opts,
    };

    this.rpcRequests.inc({ method });
    const timer = this.rpcLatency.startTimer({ method });
    let attempt = 0;

    while (true) {
      try {
        const result = await this.withTimeout(fn(), timeoutMs);
        timer({ status: 'success' });
        return result;
      } catch (err: unknown) {
        attempt++;
        const isRetryable = this.isRetryable(err);
        const exhausted = attempt > maxRetries;

        const requestId = this.requestContextService.getRequestId();
        this.logger.warn(
          {
            requestId,
            method,
            attempt,
            maxRetries,
            retrying: isRetryable && !exhausted,
            error: err instanceof Error ? err.message : String(err),
          },
          'Soroban RPC call failed',
        );

        if (!isRetryable || exhausted) {
          timer({ status: 'error' });
          const code =
            err instanceof SorobanRpcError
              ? err.code
              : SorobanErrorCode.NETWORK_ERROR;
          this.rpcErrors.inc({ code });

          if (exhausted && isRetryable) {
            throw new SorobanRpcError(
              SorobanErrorCode.MAX_RETRIES_EXCEEDED,
              `Max retries (${maxRetries}) exceeded for ${method}`,
              err,
            );
          }
          throw err;
        }

        const backoff = initialBackoffMs * Math.pow(2, attempt - 1);
        await this.sleep(backoff);
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = setTimeout(
        () =>
          reject(
            new SorobanRpcError(
              SorobanErrorCode.TIMEOUT,
              `Soroban RPC request timed out after ${ms}ms`,
            ),
          ),
        ms,
      );
      promise.then(
        (v) => {
          clearTimeout(id);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private logFailedSimulationTrace(
    tx: unknown,
    result: rpc.Api.SimulateTransactionErrorResponse,
  ): void {
    const traceLevel = config.stellar
      .simulationTraceLevel as SimulationTraceLevel;
    if (traceLevel === 'off') {
      return;
    }

    const requestId = this.requestContextService.getRequestId();
    const invocation = this.extractContractInvocation(tx);
    const simulationSummary = this.buildSimulationSummary(result);

    const trace = {
      event: 'soroban.simulation.failed',
      requestId,
      network: config.stellar.network,
      contract: invocation.contract,
      method: invocation.method,
      simulationSummary,
      operationCount: invocation.operationCount,
      operationTypes: invocation.operationTypes,
      ...(traceLevel === 'verbose' && invocation.source
        ? { transactionSource: invocation.source }
        : {}),
    };

    this.logger.error(trace, 'Soroban simulation trace captured');
  }

  private extractContractInvocation(tx: unknown): ContractInvocationSummary {
    const record = this.asRecord(tx);
    const operations = Array.isArray(record.operations)
      ? record.operations
      : [];
    const operationTypes = operations.map((op) =>
      this.safeString(this.asRecord(op).type ?? 'unknown'),
    );
    const source = this.safeString(
      record.source ?? record.sourceAccount ?? record.sourceAccountId,
    );

    for (const op of operations) {
      const operation = this.asRecord(op);
      const directContract = this.safeString(
        operation.contractId ??
          operation.contract ??
          operation.contractAddress ??
          operation.address,
      );
      const directMethod = this.safeString(
        operation.method ??
          operation.functionName ??
          operation.function ??
          operation.name,
      );

      if (directContract !== 'unknown' || directMethod !== 'unknown') {
        return {
          contract: directContract,
          method: directMethod,
          operationCount: operations.length,
          operationTypes,
          ...(source !== 'unknown' ? { source } : {}),
        };
      }

      const hostFunction = operation.func ?? operation.hostFunction;
      const extracted = this.extractHostFunctionInvocation(hostFunction);
      if (extracted.contract !== 'unknown' || extracted.method !== 'unknown') {
        return {
          ...extracted,
          operationCount: operations.length,
          operationTypes,
          ...(source !== 'unknown' ? { source } : {}),
        };
      }
    }

    return {
      contract: 'unknown',
      method: 'unknown',
      operationCount: operations.length,
      operationTypes,
      ...(source !== 'unknown' ? { source } : {}),
    };
  }

  private extractHostFunctionInvocation(hostFunction: unknown): {
    contract: string;
    method: string;
  } {
    try {
      const hostRecord = this.asRecord(hostFunction);
      const unionValue = this.asRecord(hostRecord._value);
      const unionInvocation = this.extractInvocationFields(unionValue);
      if (
        unionInvocation.contract !== 'unknown' ||
        unionInvocation.method !== 'unknown'
      ) {
        return unionInvocation;
      }

      const invokeContract = (
        hostFunction as { invokeContract?: () => unknown } | undefined
      )?.invokeContract;
      if (typeof invokeContract !== 'function') {
        return { contract: 'unknown', method: 'unknown' };
      }

      const invocation = this.asRecord(invokeContract.call(hostFunction));
      return this.extractInvocationFields(invocation);
    } catch {
      return { contract: 'unknown', method: 'unknown' };
    }
  }

  private extractInvocationFields(invocation: Record<string, unknown>): {
    contract: string;
    method: string;
  } {
    const attrs = this.asRecord(invocation._attributes);
    return {
      contract: this.safeString(this.toStellarAddress(invocation)),
      method: this.safeString(
        this.readRecordField(invocation, 'functionName') ?? attrs.functionName,
      ),
    };
  }

  private buildSimulationSummary(
    result: rpc.Api.SimulateTransactionErrorResponse,
  ): SimulationSummary {
    const record = this.asRecord(result);
    const cost = this.asRecord(record.cost);
    const summary: SimulationSummary = {
      status: 'failed',
      error: this.safeString(record.error ?? 'Unknown error', 500),
    };

    if (Array.isArray(record.events)) {
      summary.eventCount = record.events.length;
    }

    if (record.transactionData) {
      summary.hasTransactionData = true;
    }

    if (record.restorePreamble) {
      summary.hasRestorePreamble = true;
    }

    if (record.minResourceFee !== undefined) {
      summary.minResourceFee = this.safeString(record.minResourceFee);
    }

    if (cost.cpuInsns !== undefined || cost.memBytes !== undefined) {
      summary.cost = {
        ...(cost.cpuInsns !== undefined
          ? { cpuInsns: this.safeString(cost.cpuInsns) }
          : {}),
        ...(cost.memBytes !== undefined
          ? { memBytes: this.safeString(cost.memBytes) }
          : {}),
      };
    }

    return summary;
  }

  private recordSharedCacheRead(
    cache: string,
    result: 'hit' | 'miss',
    stalenessSeconds: number,
  ): void {
    try {
      this.metricsService?.recordCacheRead(cache, result, stalenessSeconds);
    } catch {
      // Shared metrics must not affect the RPC client.
    }
  }

  private setSharedCacheStaleness(cache: string): void {
    try {
      this.metricsService?.setCacheStaleness(cache, 0);
    } catch {
      // Shared metrics must not affect the RPC client.
    }
  }

  private getSimulationFingerprint(tx: unknown): string {
    if (typeof tx === 'string') return tx;
    const candidate = this.asRecord(tx) as {
      toXDR?: (encoding: string) => string;
    };
    if (typeof candidate.toXDR === 'function') {
      try {
        return candidate.toXDR('base64');
      } catch {
        // Fall through to a structural fingerprint for test doubles/SDK
        // objects that expose an incomplete XDR method.
      }
    }
    try {
      return JSON.stringify(tx) ?? String(tx);
    } catch {
      return String(tx);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private readRecordField(
    record: Record<string, unknown>,
    key: string,
  ): unknown {
    const value = record[key];
    if (typeof value !== 'function') {
      return value;
    }

    const accessor = value as (this: Record<string, unknown>) => unknown;
    return accessor.call(record);
  }

  private toStellarAddress(invocation: Record<string, unknown>): string {
    const attrs = this.asRecord(invocation._attributes);
    const contractAddress =
      this.readRecordField(invocation, 'contractAddress') ??
      attrs.contractAddress;
    if (!contractAddress) {
      return 'unknown';
    }

    try {
      return Address.fromScAddress(contractAddress as never).toString();
    } catch {
      return this.safeString(contractAddress);
    }
  }

  private safeString(value: unknown, maxLength = 120): string {
    if (value === undefined || value === null) {
      return 'unknown';
    }

    let raw: string;
    if (typeof value === 'string') {
      raw = value;
    } else if (Buffer.isBuffer(value)) {
      raw = value.toString('hex');
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      raw = value.toString();
    } else if (typeof value === 'symbol') {
      raw = value.description ?? 'symbol';
    } else if (value instanceof Error) {
      raw = value.message;
    } else {
      raw = Array.isArray(value) ? `array(${value.length})` : 'object';
    }

    return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof SorobanRpcError) {
      return [
        SorobanErrorCode.TIMEOUT,
        SorobanErrorCode.NETWORK_ERROR,
      ].includes(err.code);
    }
    // Retry on network-level errors
    return (
      err instanceof Error &&
      (err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('fetch failed'))
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
