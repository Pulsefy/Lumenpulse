import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import stellarConfig from '../config/stellar.config';

export class CircuitBreakerOpenException extends Error {
  constructor(
    public readonly dependency: string,
    message: string,
  ) {
    super(`Circuit breaker is OPEN for dependency '${dependency}': ${message}`);
    this.name = 'CircuitBreakerOpenException';
  }
}

export interface ResiliencePolicyConfig {
  name: string;
  maxRetries: number;
  initialBackoffMs: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

export class ResiliencePolicy {
  private readonly logger: Logger;

  // Circuit Breaker State
  private cbState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private lastStateTransitionTime = Date.now();
  private halfOpenSuccesses = 0;

  // Retry Budget State (Token Bucket)
  private readonly maxBudgetTokens = 100.0;
  private readonly tokenCostPerRetry = 10.0;
  private readonly tokenRewardPerSuccess = 1.0;
  private budgetTokens = this.maxBudgetTokens;

  constructor(
    private readonly config: ResiliencePolicyConfig,
    private readonly metricsService?: MetricsService,
  ) {
    this.logger = new Logger(`ResiliencePolicy:${config.name}`);
    this.updateMetrics();
  }

  private updateMetrics(): void {
    if (!this.metricsService) return;

    try {
      const stateGauge = this.metricsService.getOrCreateGauge(
        'resilience_circuit_breaker_state',
        'State of circuit breaker (0=Closed, 1=Open, 2=Half-Open)',
        ['dependency'],
      );
      const stateVal =
        this.cbState === 'CLOSED' ? 0 : this.cbState === 'OPEN' ? 1 : 2;
      stateGauge.labels(this.config.name).set(stateVal);

      const budgetGauge = this.metricsService.getOrCreateGauge(
        'resilience_retry_budget_tokens',
        'Remaining tokens in the retry budget',
        ['dependency'],
      );
      budgetGauge.labels(this.config.name).set(this.budgetTokens);
    } catch (err) {
      this.logger.debug(
        `Failed to update metrics: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private recordFastFailure(): void {
    if (!this.metricsService) return;
    try {
      const fastFailCounter = this.metricsService.getOrCreateCounter(
        'resilience_fast_failures_total',
        'Total number of requests failed fast due to open circuit',
        ['dependency'],
      );
      fastFailCounter.labels(this.config.name).inc();
    } catch (err) {
      // ignore
    }
  }

  private recordRetry(
    method: string,
    status: 'success' | 'exhausted' | 'budget_depleted',
  ): void {
    if (!this.metricsService) return;
    try {
      const retriesCounter = this.metricsService.getOrCreateCounter(
        'resilience_retries_total',
        'Total number of retries executed',
        ['dependency', 'method', 'status'],
      );
      retriesCounter.labels(this.config.name, method, status).inc();
    } catch (err) {
      // ignore
    }
  }

  private recordCircuitTrip(): void {
    if (!this.metricsService) return;
    try {
      const trippedCounter = this.metricsService.getOrCreateCounter(
        'resilience_circuit_breaker_tripped_total',
        'Total number of times the circuit breaker tripped open',
        ['dependency'],
      );
      trippedCounter.labels(this.config.name).inc();
    } catch (err) {
      // ignore
    }
  }

  async execute<T>(
    method: string,
    operation: () => Promise<T>,
    isFailureFn: (error: unknown) => boolean = () => true,
  ): Promise<T> {
    this.checkCircuitState();

    if (this.cbState === 'OPEN') {
      this.logger.warn(
        `Request to ${this.config.name}.${method} failed fast: Circuit Breaker is OPEN`,
      );
      this.recordFastFailure();
      throw new CircuitBreakerOpenException(
        this.config.name,
        'Downstream service is unhealthy',
      );
    }

    let attempt = 0;

    while (true) {
      try {
        const result = await operation();
        this.onSuccess();
        return result;
      } catch (error) {
        attempt++;
        const isSystemFailure = isFailureFn(error);

        if (!isSystemFailure) {
          // Expected business/client-side error (e.g. 404/400).
          // Propagate immediately without counting as failure or retrying.
          throw error;
        }

        const isLastAttempt = attempt > this.config.maxRetries;

        if (isLastAttempt) {
          this.onFailure();
          throw error;
        }

        // Check if retry budget has enough tokens
        if (this.budgetTokens < this.tokenCostPerRetry) {
          this.logger.warn(
            `Retry budget exhausted for ${this.config.name} (remaining: ${this.budgetTokens.toFixed(1)} tokens). Bypassing retry.`,
          );
          this.recordRetry(method, 'budget_depleted');
          this.onFailure();
          throw error;
        }

        // Deduct retry cost
        this.budgetTokens -= this.tokenCostPerRetry;
        this.updateMetrics();
        this.recordRetry(method, 'success');

        // Exponential backoff with random jitter (50% to 150% of the nominal delay)
        const nominalDelay =
          this.config.initialBackoffMs * Math.pow(2, attempt - 1);
        const jitter = 0.5 + Math.random();
        const backoffDelay = Math.round(nominalDelay * jitter);

        this.logger.warn(
          `Error calling ${this.config.name}.${method}. Retrying (attempt ${attempt}/${this.config.maxRetries}) in ${backoffDelay}ms. Error: ${error instanceof Error ? error.message : String(error)}`,
        );

        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }
  }

  private checkCircuitState(): void {
    if (this.cbState === 'OPEN') {
      const elapsed = Date.now() - this.lastStateTransitionTime;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
  }

  private transitionTo(newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'): void {
    const oldState = this.cbState;
    if (oldState === newState) return;

    this.cbState = newState;
    this.lastStateTransitionTime = Date.now();

    if (newState === 'OPEN') {
      this.recordCircuitTrip();
      this.logger.error(
        `Circuit breaker tripped! State changed from ${oldState} to ${newState} for dependency '${this.config.name}'`,
      );
    } else {
      this.logger.log(
        `Circuit breaker state changed from ${oldState} to ${newState} for dependency '${this.config.name}'`,
      );
    }

    this.updateMetrics();
  }

  private onSuccess(): void {
    // Increment tokens on success up to maximum capacity
    this.budgetTokens = Math.min(
      this.maxBudgetTokens,
      this.budgetTokens + this.tokenRewardPerSuccess,
    );

    if (this.cbState === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxRequests) {
        this.transitionTo('CLOSED');
        this.consecutiveFailures = 0;
      }
    } else if (this.cbState === 'CLOSED') {
      this.consecutiveFailures = 0;
    }

    this.updateMetrics();
  }

  private onFailure(): void {
    if (this.cbState === 'CLOSED') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
      }
    } else if (this.cbState === 'HALF_OPEN') {
      // Any failure in half-open immediately returns the circuit to OPEN and resets timeout
      this.transitionTo('OPEN');
    }

    this.updateMetrics();
  }

  public getStatus() {
    return {
      state: this.cbState,
      consecutiveFailures: this.consecutiveFailures,
      budgetTokens: this.budgetTokens,
      lastStateTransition: new Date(this.lastStateTransitionTime).toISOString(),
    };
  }
}

@Injectable()
export class ResilienceService {
  private readonly policies = new Map<string, ResiliencePolicy>();

  constructor(
    @Inject(stellarConfig.KEY)
    private readonly config: ConfigType<typeof stellarConfig>,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  getPolicy(name: 'horizon' | 'soroban'): ResiliencePolicy {
    if (!this.policies.has(name)) {
      const policyConfig: ResiliencePolicyConfig = {
        name,
        maxRetries: this.config.retryAttempts,
        initialBackoffMs: this.config.retryDelay,
        failureThreshold: 5, // Open breaker after 5 consecutive failures
        resetTimeoutMs: 15_000, // Stay open for 15 seconds before transitioning to half-open
        halfOpenMaxRequests: 2, // Require 2 consecutive successes in half-open to close breaker
      };

      this.policies.set(
        name,
        new ResiliencePolicy(policyConfig, this.metricsService),
      );
    }

    return this.policies.get(name)!;
  }
}
