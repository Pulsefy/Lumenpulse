import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Transaction, FeeBumpTransaction, xdr } from '@stellar/stellar-sdk';
import { Server, Api, assembleTransaction } from '@stellar/stellar-sdk/rpc';

import { SOROBAN_RPC_CONFIG } from './rpc.config';
import type { SorobanRpcConfig } from './rpc.config';
import { RpcError, RpcErrorCode } from './rpc.errors';
import { RpcObservabilityService } from './rpc.observability.service';


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  return Math.random() * Math.min(exponential, maxMs);
}

function toRpcError(raw: unknown, method: string): RpcError {
  if (raw instanceof RpcError) return raw;

  if (raw instanceof Error) {
    const msg = raw.message.toLowerCase();

    if (raw.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted')) {
      return new RpcError({ message: `Soroban RPC timeout on ${method}`, code: RpcErrorCode.TIMEOUT, cause: raw });
    }

    if (
      msg.includes('failed to fetch') ||
      msg.includes('enotfound') ||
      msg.includes('econnrefused') ||
      msg.includes('network')
    ) {
      return new RpcError({
        message: `Soroban RPC network unavailable on ${method}: ${raw.message}`,
        code: RpcErrorCode.NETWORK_UNAVAILABLE,
        cause: raw,
      });
    }

    // Stellar SDK wraps JSON-RPC errors with a numeric `code` property
    const asRecord = raw as unknown as Record<string, unknown>;
    if (typeof asRecord['code'] === 'number') {
      return new RpcError({
        message: `Soroban RPC server error on ${method}: ${raw.message}`,
        code: RpcErrorCode.RPC_ERROR,
        rpcCode: asRecord['code'] as number,
        cause: raw,
      });
    }

    if (msg.includes('json') || msg.includes('parse')) {
      return new RpcError({ message: `Soroban RPC parse error on ${method}`, code: RpcErrorCode.PARSE_ERROR, cause: raw });
    }
  }

  return new RpcError({ message: `Unknown Soroban RPC error on ${method}`, code: RpcErrorCode.UNKNOWN, cause: raw });
}

function isFatal(err: RpcError): boolean {
  return err.code === RpcErrorCode.RPC_ERROR || err.code === RpcErrorCode.PARSE_ERROR;
}


@Injectable()
export class SorobanRpcService implements OnModuleInit {
  private server!: Server;

  constructor(
    @Inject(SOROBAN_RPC_CONFIG)
    private readonly config: SorobanRpcConfig,
    private readonly obs: RpcObservabilityService,
  ) {}

  onModuleInit(): void {
    this.server = new Server(this.config.rpcUrl, {
      allowHttp: this.config.rpcUrl.startsWith('http://'),
    });
  }

 

  async call<T>(method: string, fn: (server: Server) => Promise<T>): Promise<T> {
    const { maxAttempts, timeoutMs, baseDelayMs, maxDelayMs } = this.config;
    this.obs.recordCall(method);

    let lastError: RpcError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.obs.logAttemptStart(method, attempt);
      const start = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await fn(this.server);
        const latencyMs = Date.now() - start;
        clearTimeout(timer);

        this.obs.logAttemptSuccess(method, attempt, latencyMs);
        this.obs.recordSuccess(method, latencyMs);
        return result;
      } catch (raw) {
        const latencyMs = Date.now() - start;
        clearTimeout(timer);

        lastError = toRpcError(raw, method);
        this.obs.logAttemptFailed(method, attempt, latencyMs, lastError.code);
        this.obs.recordFailure(method, latencyMs);

        if (isFatal(lastError) || attempt === maxAttempts) break;

        this.obs.recordRetry(method);
        await sleep(jitteredDelay(attempt, baseDelayMs, maxDelayMs));
      }
    }

    this.obs.logRetriesExhausted(method, maxAttempts, lastError!.code);
    throw new RpcError({
      message: `Soroban RPC retries exhausted for ${method}: ${lastError!.message}`,
      code: RpcErrorCode.RETRIES_EXHAUSTED,
      cause: lastError,
    });
  }

 
  getLatestLedger(): Promise<Api.GetLatestLedgerResponse> {
    return this.call('getLatestLedger', (s) => s.getLatestLedger());
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<Api.GetLedgerEntriesResponse> {
    return this.call('getLedgerEntries', (s) => s.getLedgerEntries(...keys));
  }

  simulateTransaction(tx: Transaction | FeeBumpTransaction): Promise<Api.SimulateTransactionResponse> {
    return this.call('simulateTransaction', (s) => s.simulateTransaction(tx));
  }

  sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<Api.SendTransactionResponse> {
    return this.call('sendTransaction', (s) => s.sendTransaction(tx));
  }

  getTransaction(hash: string): Promise<Api.GetTransactionResponse> {
    return this.call('getTransaction', (s) => s.getTransaction(hash));
  }

  async prepareAndSend(
    tx: Transaction,
    signerFn: (assembled: Transaction) => Promise<Transaction>,
    pollIntervalMs = 1_500,
    maxPollAttempts = 20,
  ): Promise<Api.GetTransactionResponse> {
    const simResult = await this.simulateTransaction(tx);
    if (Api.isSimulationError(simResult)) {
      throw new RpcError({ message: `Simulation failed: ${simResult.error}`, code: RpcErrorCode.RPC_ERROR });
    }

    const assembled = assembleTransaction(tx, simResult).build();
    const signed = await signerFn(assembled);

    const sendResult = await this.sendTransaction(signed);
    if (sendResult.status === 'ERROR') {
      throw new RpcError({
        message: `sendTransaction failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`,
        code: RpcErrorCode.RPC_ERROR,
      });
    }

    const { hash } = sendResult;
    for (let i = 0; i < maxPollAttempts; i++) {
      await sleep(pollIntervalMs);
      const status = await this.getTransaction(hash);
      if (status.status !== Api.GetTransactionStatus.NOT_FOUND) {
        return status;
      }
    }

    throw new RpcError({
      message: `Transaction ${hash} did not finalise after ${maxPollAttempts} polls`,
      code: RpcErrorCode.TIMEOUT,
    });
  }
}