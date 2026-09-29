import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { config } from '../lib/config';
import { StellarService } from '../stellar/stellar.service';
import { ContractHealthService } from './contract-health.service';

export type SmokeStatus = 'pass' | 'warn' | 'fail';

export type SmokeCategory = 'config' | 'dependency' | 'contract';

export interface DeploymentSmokeCheck {
  /** Stable identifier — CI can assert on this without parsing prose. */
  id: string;
  category: SmokeCategory;
  status: SmokeStatus;
  /** Fixed, non-sensitive explanation. Never contains a config value. */
  message: string;
}

export interface DeploymentSmokeSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
}

export interface DeploymentSmokeReport {
  /** Worst status across all checks. */
  status: SmokeStatus;
  /** Convenience boolean for CI: true unless something failed. */
  ready: boolean;
  checkedAt: string;
  durationMs: number;
  network: string;
  environment: string;
  summary: DeploymentSmokeSummary;
  checks: DeploymentSmokeCheck[];
}

/**
 * Environment variables the backend cannot run without. Presence only is ever
 * reported — never the value, never a prefix, never a length.
 */
const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'PORT',
  'JWT_SECRET',
  'STELLAR_SERVER_SECRET',
] as const;

/**
 * Variables that are only required in some environments. Each entry explains
 * the condition so a red CI check is actionable without reading this file.
 */
const CONDITIONAL_ENV_VARS: {
  name: string;
  isRequired: () => boolean;
  requirement: string;
}[] = [
  {
    name: 'CORS_ORIGIN',
    isRequired: () => config.nodeEnv === 'production',
    requirement: 'required when NODE_ENV=production',
  },
  {
    name: 'PYTHON_API_URL',
    isRequired: () =>
      config.nodeEnv !== 'development' && config.nodeEnv !== 'test',
    requirement: 'required outside development and test',
  },
];

/**
 * Single endpoint for CI and Vercel deployment checks: is this backend, and
 * are the testnet dependencies it needs, actually ready?
 *
 * Public-safety rules this service holds to:
 *  - Environment variables are reported as present/absent by name only.
 *  - Contract IDs come from ContractHealthService, which already redacts them.
 *  - Dependency failures use fixed messages, never the driver's error text,
 *    so a connection string or host can never surface in the response.
 */
@Injectable()
export class DeploymentSmokeService {
  private readonly logger = new Logger(DeploymentSmokeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly stellarService: StellarService,
    private readonly contractHealthService: ContractHealthService,
  ) {}

  async getSmokeReport(): Promise<DeploymentSmokeReport> {
    const startedAt = Date.now();

    const [dependencyChecks, contractChecks] = await Promise.all([
      this.checkDependencies(),
      this.checkContracts(),
    ]);

    const checks = [
      ...this.checkEnvironment(),
      ...dependencyChecks,
      ...contractChecks,
    ];
    const summary = this.summarize(checks);
    const status = this.worstStatus(checks);

    if (status === 'fail') {
      this.logger.warn(
        `Deployment smoke check failed: ${summary.failed} of ${summary.total} checks failed`,
      );
    }

    return {
      status,
      ready: status !== 'fail',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      network: config.stellar.network,
      environment: config.nodeEnv,
      summary,
      checks,
    };
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  private checkEnvironment(): DeploymentSmokeCheck[] {
    const checks: DeploymentSmokeCheck[] = REQUIRED_ENV_VARS.map((name) => ({
      id: `env.${name}`,
      category: 'config' as const,
      status: this.isEnvPresent(name) ? ('pass' as const) : ('fail' as const),
      message: this.isEnvPresent(name)
        ? `${name} is set`
        : `${name} is missing — the backend cannot operate without it`,
    }));

    // DB_DATABASE accepts DB_NAME as a fallback (see lib/config.ts).
    const hasDatabaseName =
      this.isEnvPresent('DB_DATABASE') || this.isEnvPresent('DB_NAME');
    checks.push({
      id: 'env.DB_DATABASE',
      category: 'config',
      status: hasDatabaseName ? 'pass' : 'fail',
      message: hasDatabaseName
        ? 'DB_DATABASE (or DB_NAME) is set'
        : 'DB_DATABASE is missing — set DB_DATABASE or DB_NAME',
    });

    for (const conditional of CONDITIONAL_ENV_VARS) {
      const present = this.isEnvPresent(conditional.name);
      const required = conditional.isRequired();

      checks.push({
        id: `env.${conditional.name}`,
        category: 'config',
        status: present ? 'pass' : required ? 'fail' : 'warn',
        message: present
          ? `${conditional.name} is set`
          : `${conditional.name} is not set (${conditional.requirement})`,
      });
    }

    return checks;
  }

  private isEnvPresent(name: string): boolean {
    const raw = process.env[name];
    return typeof raw === 'string' && raw.trim().length > 0;
  }

  // ── Dependencies ───────────────────────────────────────────────────────────

  private async checkDependencies(): Promise<DeploymentSmokeCheck[]> {
    const [database, redis, horizon] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkHorizon(),
    ]);

    return [database, redis, horizon];
  }

  private async checkDatabase(): Promise<DeploymentSmokeCheck> {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        id: 'dependency.database',
        category: 'dependency',
        status: 'pass',
        message: 'Database accepted a connection',
      };
    } catch (error) {
      // The driver error can embed host/user details — log it, never return it.
      this.logger.error(
        `Deployment smoke database check failed: ${this.describeError(error)}`,
      );
      return {
        id: 'dependency.database',
        category: 'dependency',
        status: 'fail',
        message: 'Database is unreachable',
      };
    }
  }

  private async checkRedis(): Promise<DeploymentSmokeCheck> {
    const isHealthy = await this.cacheService.checkHealth();

    return {
      id: 'dependency.redis',
      category: 'dependency',
      // Redis degrades rather than breaks the API, so a miss is a warning.
      status: isHealthy ? 'pass' : 'warn',
      message: isHealthy
        ? 'Redis cache responded'
        : 'Redis cache is unreachable — the API runs uncached',
    };
  }

  private async checkHorizon(): Promise<DeploymentSmokeCheck> {
    const isHealthy = await this.stellarService.checkHealth();

    return {
      id: 'dependency.horizon',
      category: 'dependency',
      status: isHealthy ? 'pass' : 'fail',
      message: isHealthy
        ? `Stellar Horizon responded on ${config.stellar.network}`
        : `Stellar Horizon is unreachable on ${config.stellar.network}`,
    };
  }

  // ── Contracts ──────────────────────────────────────────────────────────────

  private async checkContracts(): Promise<DeploymentSmokeCheck[]> {
    try {
      const report = await this.contractHealthService.getContractHealthReport();

      return report.contracts.map((contract) => ({
        id: `contract.${contract.name}`,
        category: 'contract' as const,
        status: this.contractStatusToSmokeStatus(contract.status),
        message: this.describeContract(
          contract.name,
          contract.status,
          contract.envVar,
        ),
      }));
    } catch (error) {
      this.logger.error(
        `Deployment smoke contract check failed: ${this.describeError(error)}`,
      );
      return [
        {
          id: 'contract.report',
          category: 'contract',
          status: 'fail',
          message: 'Contract reachability could not be determined',
        },
      ];
    }
  }

  private contractStatusToSmokeStatus(
    status: 'reachable' | 'misconfigured' | 'unreachable',
  ): SmokeStatus {
    return status === 'reachable' ? 'pass' : 'fail';
  }

  private describeContract(
    name: string,
    status: 'reachable' | 'misconfigured' | 'unreachable',
    envVar: string,
  ): string {
    if (status === 'reachable') {
      return `${name} contract is reachable`;
    }

    if (status === 'misconfigured') {
      return `${name} contract is misconfigured — check ${envVar}`;
    }

    return `${name} contract is configured but not callable on ${config.stellar.network}`;
  }

  // ── Aggregation ────────────────────────────────────────────────────────────

  private summarize(checks: DeploymentSmokeCheck[]): DeploymentSmokeSummary {
    return {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'pass').length,
      warned: checks.filter((check) => check.status === 'warn').length,
      failed: checks.filter((check) => check.status === 'fail').length,
    };
  }

  private worstStatus(checks: DeploymentSmokeCheck[]): SmokeStatus {
    if (checks.some((check) => check.status === 'fail')) {
      return 'fail';
    }
    if (checks.some((check) => check.status === 'warn')) {
      return 'warn';
    }
    return 'pass';
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
