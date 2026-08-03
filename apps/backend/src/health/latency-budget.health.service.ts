import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  latencyBudgetConfig,
  LatencyBudgetThreshold,
} from './latency-budget.config';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Severity classification for a single dependency */
export type LatencyHealthState = 'ok' | 'degraded' | 'hard_down';

export interface DependencyLatencyResult {
  /** Human-readable dependency name */
  name: string;
  /** URL that was probed */
  url: string;
  /** Measured round-trip time in milliseconds, undefined when unreachable */
  latencyMs: number | undefined;
  /** Thresholds used for classification */
  thresholds: LatencyBudgetThreshold;
  /** Derived health state */
  state: LatencyHealthState;
  /** Optional human-readable explanation */
  message?: string;
}

export interface LatencyBudgetReport {
  /**
   * Overall status across all checked dependencies:
   *   - ok        → all within budget
   *   - degraded  → at least one dependency is slow but reachable
   *   - hard_down → at least one dependency is unreachable or over hard-down threshold
   */
  overallState: LatencyHealthState;
  checkedAt: string;
  dependencies: DependencyLatencyResult[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Soroban RPC default endpoints, keyed by network */
const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

const DEFAULT_HORIZON_URLS = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
} as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class LatencyBudgetHealthService {
  private readonly logger = new Logger(LatencyBudgetHealthService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Probes Horizon and Soroban RPC and returns a structured latency budget
   * report. All requests run concurrently; individual failures never propagate
   * as unhandled exceptions — they are captured and classified as hard_down.
   */
  async getLatencyBudgetReport(): Promise<LatencyBudgetReport> {
    const network = (process.env.STELLAR_NETWORK ?? 'testnet') as
      'testnet' | 'mainnet';

    const horizonUrl =
      process.env.STELLAR_HORIZON_URL ?? DEFAULT_HORIZON_URLS[network];
    const sorobanRpcUrl =
      process.env.STELLAR_SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URLS[network];

    const [horizonResult, rpcResult] = await Promise.all([
      this.probeEndpoint('horizon', horizonUrl, latencyBudgetConfig.horizon),
      this.probeRpc(
        'sorobanRpc',
        sorobanRpcUrl,
        latencyBudgetConfig.sorobanRpc,
      ),
    ]);

    const dependencies: DependencyLatencyResult[] = [horizonResult, rpcResult];

    const overallState = this.deriveOverallState(dependencies);

    return {
      overallState,
      checkedAt: new Date().toISOString(),
      dependencies,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Probes an HTTP endpoint with a HEAD/GET and measures round-trip latency.
   */
  private async probeEndpoint(
    name: string,
    url: string,
    thresholds: LatencyBudgetThreshold,
  ): Promise<DependencyLatencyResult> {
    const started = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(url, {
          // Hard ceiling is the hard-down threshold + a 500 ms margin to
          // distinguish "timeout" from "very slow but answered".
          timeout: thresholds.hardDownMs + 500,
          headers: { Accept: 'application/json' },
        }),
      );

      const latencyMs = Date.now() - started;

      return this.classify(name, url, latencyMs, thresholds);
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = this.toMessage(error);

      this.logger.warn(`Latency probe for ${name} failed: ${message}`);

      return {
        name,
        url,
        latencyMs,
        thresholds,
        state: 'hard_down',
        message,
      };
    }
  }

  /**
   * Probes the Soroban JSON-RPC endpoint using the `getHealth` method so we
   * get an application-level signal rather than just a TCP handshake.
   */
  private async probeRpc(
    name: string,
    url: string,
    thresholds: LatencyBudgetThreshold,
  ): Promise<DependencyLatencyResult> {
    const started = Date.now();

    try {
      await firstValueFrom(
        this.httpService.post(
          url,
          { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] },
          {
            timeout: thresholds.hardDownMs + 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const latencyMs = Date.now() - started;

      return this.classify(name, url, latencyMs, thresholds);
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = this.toMessage(error);

      this.logger.warn(`Latency probe for ${name} failed: ${message}`);

      return {
        name,
        url,
        latencyMs,
        thresholds,
        state: 'hard_down',
        message,
      };
    }
  }

  /**
   * Classifies a successful probe result according to the latency thresholds.
   */
  private classify(
    name: string,
    url: string,
    latencyMs: number,
    thresholds: LatencyBudgetThreshold,
  ): DependencyLatencyResult {
    if (latencyMs >= thresholds.hardDownMs) {
      return {
        name,
        url,
        latencyMs,
        thresholds,
        state: 'hard_down',
        message: `Latency ${latencyMs}ms exceeds hard-down threshold (${thresholds.hardDownMs}ms)`,
      };
    }

    if (latencyMs >= thresholds.degradedMs) {
      return {
        name,
        url,
        latencyMs,
        thresholds,
        state: 'degraded',
        message: `Latency ${latencyMs}ms exceeds degraded threshold (${thresholds.degradedMs}ms)`,
      };
    }

    return { name, url, latencyMs, thresholds, state: 'ok' };
  }

  /**
   * Rolls up individual states: any hard_down wins; any degraded wins over ok.
   */
  private deriveOverallState(
    results: DependencyLatencyResult[],
  ): LatencyHealthState {
    if (results.some((r) => r.state === 'hard_down')) return 'hard_down';
    if (results.some((r) => r.state === 'degraded')) return 'degraded';
    return 'ok';
  }

  private toMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
