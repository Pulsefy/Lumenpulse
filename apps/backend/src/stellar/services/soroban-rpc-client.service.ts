import { Injectable, Logger } from '@nestjs/common';
import {
  rpc,
  Account,
  TransactionBuilder,
  BASE_FEE,
  Contract,
} from '@stellar/stellar-sdk';
import { Counter, Histogram, Registry } from 'prom-client';
import { config } from '../../lib/config';

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
}

const DEFAULT_OPTIONS: Required<SorobanClientOptions> = {
  timeoutMs: config.stellar.timeout ?? 30_000,
  maxRetries: 3,
  initialBackoffMs: 500,
};

@Injectable()
export class SorobanRpcClientService {
  private readonly logger = new Logger(SorobanRpcClientService.name);
  private readonly server: rpc.Server;

  // Prometheus metrics
  private readonly rpcLatency: Histogram;
  private readonly rpcErrors: Counter;
  private readonly rpcRequests: Counter;

  constructor(registry?: Registry) {
    const rpcUrl =
      config.stellar.sorobanRpcUrl ??
      (config.stellar.network === 'mainnet'
        ? 'https://soroban.stellar.org'
        : 'https://soroban-testnet.stellar.org');

    this.server = new rpc.Server(rpcUrl, {
      timeout: DEFAULT_OPTIONS.timeoutMs,
      allowHttp: rpcUrl.startsWith('http://'),
    });

    const reg = registry ?? new Registry();

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

  /** Simulate a transaction with retries */
  async simulateTransaction(
    tx: Parameters<rpc.Server['simulateTransaction']>[0],
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    return this.withRetry('simulateTransaction', opts, async () => {
      const result = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(result)) {
        throw new SorobanRpcError(
          SorobanErrorCode.SIMULATION_FAILED,
          `Simulation failed: ${result.error ?? 'Unknown error'}`,
        );
      }
      return result;
    });
  }

  /** Send a transaction with retries */
  async sendTransaction(
    tx: Parameters<rpc.Server['sendTransaction']>[0],
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SendTransactionResponse> {
    return this.withRetry('sendTransaction', opts, async () => {
      const result = await this.server.sendTransaction(tx);
      if (result.status === 'ERROR') {
        throw new SorobanRpcError(
          SorobanErrorCode.SUBMISSION_FAILED,
          `Transaction submission failed: ${JSON.stringify(result.errorResult ?? 'Unknown')}`,
        );
      }
      return result;
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

    return this.simulateTransaction(tx, opts);
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
      } catch (err) {
        attempt++;
        const isRetryable = this.isRetryable(err);
        const exhausted = attempt > maxRetries;

        this.logger.warn(
          {
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
          reject(new Error(e instanceof Error ? e.message : String(e)));
        },
      );
    });
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
