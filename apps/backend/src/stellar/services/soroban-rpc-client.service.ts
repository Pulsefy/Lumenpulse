import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  rpc,
  Account,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  xdr,
} from '@stellar/stellar-sdk';
import { Counter, Histogram, Registry } from 'prom-client';
import { config } from '../../lib/config';
import { ResilienceService } from './resilience.service';

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

  constructor(
    private readonly resilienceService: ResilienceService,
    @Optional() registry?: Registry,
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
    return this.executeWithResilience('getAccount', async () => {
      const account = await this.server.getAccount(publicKey);
      return account;
    });
  }

  /** Simulate a transaction with retries */
  async simulateTransaction(
    tx: Parameters<rpc.Server['simulateTransaction']>[0],
    opts?: SorobanClientOptions,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    return this.executeWithResilience('simulateTransaction', async () => {
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
    return this.executeWithResilience('sendTransaction', async () => {
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
    return this.executeWithResilience('getTransaction', async () => {
      return this.server.getTransaction(hash);
    });
  }

  /** Fetch ledger entries resiliently */
  async getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<rpc.Api.GetLedgerEntriesResponse> {
    return this.executeWithResilience('getLedgerEntries', async () => {
      return this.server.getLedgerEntries(...keys);
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

  /** Check node health directly, bypassing circuit breaker */
  async checkHealth(): Promise<boolean> {
    try {
      const health = await this.server.getHealth();
      return health.status === 'healthy';
    } catch (err) {
      this.logger.warn(
        `Soroban RPC health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Expose the raw server for advanced usage */
  get rawServer(): rpc.Server {
    return this.server;
  }

  private async executeWithResilience<T>(
    method: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.rpcRequests.inc({ method });
    const timer = this.rpcLatency.startTimer({ method });

    try {
      const result = await this.resilienceService
        .getPolicy('soroban')
        .execute(method, fn, (err) => this.isSorobanSystemFailure(err));
      timer({ status: 'success' });
      return result;
    } catch (err) {
      timer({ status: 'error' });
      const code = this.getErrorCode(err);
      this.rpcErrors.inc({ code });
      throw err;
    }
  }

  private isSorobanSystemFailure(err: unknown): boolean {
    if (err instanceof SorobanRpcError) {
      return [
        SorobanErrorCode.TIMEOUT,
        SorobanErrorCode.NETWORK_ERROR,
      ].includes(err.code);
    }
    return (
      err instanceof Error &&
      (err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('fetch failed') ||
        err.message.includes('request timed out') ||
        err.name === 'CircuitBreakerOpenException')
    );
  }

  private getErrorCode(err: unknown): string {
    if (err instanceof SorobanRpcError) {
      return err.code;
    }
    if (err instanceof Error && err.name === 'CircuitBreakerOpenException') {
      return 'CIRCUIT_BREAKER_OPEN';
    }
    return SorobanErrorCode.NETWORK_ERROR;
  }
}

