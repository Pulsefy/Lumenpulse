import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { config } from '../lib/config';
import { CacheService } from '../cache/cache.service';
import { StellarService } from '../stellar/stellar.service';

type SmokeStatus = 'ready' | 'degraded' | 'not_ready';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  status: CheckStatus;
  message?: string;
}

interface EnvChecks {
  requiredConfig: CheckResult;
  requiredSecrets: CheckResult;
  contractConfig: CheckResult;
}

interface DependencyChecks {
  database: CheckResult;
  redis: CheckResult;
  horizon: CheckResult;
  contracts: CheckResult;
}

export interface SmokeReport {
  status: SmokeStatus;
  service: 'lumenpulse-backend';
  version: string;
  environment: string;
  network: 'testnet' | 'mainnet';
  checkedAt: string;
  durationMs: number;
  checks: {
    env: EnvChecks;
    dependencies: DependencyChecks;
  };
  missing?: {
    requiredConfig: string[];
    requiredSecrets: string[];
    contracts: string[];
  };
}

const REQUIRED_CONFIG = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_DATABASE',
  'PORT',
] as const;

const REQUIRED_SECRETS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'STELLAR_SERVER_SECRET',
] as const;

const CONTRACT_DEFS: ReadonlyArray<{ name: string; envVar: string }> = [
  { name: 'lumenToken', envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN' },
  { name: 'crowdfundVault', envVar: 'STELLAR_CONTRACT_CROWDFUND_VAULT' },
  { name: 'projectRegistry', envVar: 'STELLAR_CONTRACT_PROJECT_REGISTRY' },
  { name: 'contributorRegistry', envVar: 'STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY' },
  { name: 'matchingPool', envVar: 'STELLAR_CONTRACT_MATCHING_POOL' },
  { name: 'treasury', envVar: 'STELLAR_CONTRACT_TREASURY' },
] as const;

@Injectable()
export class SmokeService {
  private readonly logger = new Logger(SmokeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly stellarService: StellarService,
  ) {}

  async getSmokeReport(): Promise<SmokeReport> {
    const startedAt = Date.now();

    const env = this.checkEnv();
    const dependencies = await this.checkDependencies();

    const criticalFails =
      env.requiredConfig.status === 'fail' ||
      env.requiredSecrets.status === 'fail' ||
      dependencies.database.status === 'fail' ||
      (dependencies.contracts.status === 'fail' &&
        env.contractConfig.status === 'ok');

    const anyWarn =
      Object.values(env).some((c) => c.status === 'warn') ||
      Object.values(dependencies).some((c) => c.status === 'warn');

    const status: SmokeStatus = criticalFails
      ? 'not_ready'
      : anyWarn
        ? 'degraded'
        : 'ready';

    const missing = this.collectMissing(env);

    return {
      status,
      service: 'lumenpulse-backend',
      version: process.env.npm_package_version ?? '0.0.0',
      environment: config.environment,
      network: config.stellar.network,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks: { env, dependencies },
      ...(missing && { missing }),
    };
  }

  private checkEnv(): EnvChecks {
    const missingConfig: string[] = [];
    for (const key of REQUIRED_CONFIG) {
      if (!process.env[key] || String(process.env[key]).trim().length === 0) {
        missingConfig.push(key);
      }
    }

    const missingSecrets: string[] = [];
    for (const key of REQUIRED_SECRETS) {
      if (!process.env[key] || String(process.env[key]).trim().length === 0) {
        missingSecrets.push(key);
      }
    }

    const missingContracts: string[] = [];
    const invalidContracts: string[] = [];
    for (const def of CONTRACT_DEFS) {
      const raw = process.env[def.envVar];
      if (!raw || String(raw).trim().length === 0) {
        missingContracts.push(def.envVar);
        continue;
      }
      if (!StrKey.isValidContract(String(raw).trim())) {
        invalidContracts.push(def.envVar);
      }
    }

    const requiredConfig: CheckResult =
      missingConfig.length === 0
        ? { status: 'ok' }
        : {
            status: 'fail',
            message: `Missing required config: ${missingConfig.join(', ')}`,
          };

    const requiredSecrets: CheckResult =
      missingSecrets.length === 0
        ? { status: 'ok' }
        : {
            status: 'fail',
            message: `Missing required secrets: ${missingSecrets.join(', ')}`,
          };

    const hasContractProblems =
      missingContracts.length > 0 || invalidContracts.length > 0;

    const contractConfig: CheckResult = hasContractProblems
      ? {
          status: missingContracts.length === CONTRACT_DEFS.length ? 'warn' : 'warn',
          message: invalidContracts.length
            ? `Invalid contract IDs: ${invalidContracts.join(', ')}`
            : `Unconfigured contracts: ${missingContracts.join(', ')}`,
        }
      : { status: 'ok' };

    return { requiredConfig, requiredSecrets, contractConfig };
  }

  private async checkDependencies(): Promise<DependencyChecks> {
    const [database, redis, horizon] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkHorizon(),
    ]);
    const contracts = await this.checkContracts(horizon.status);
    return { database, redis, horizon, contracts };
  }

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      this.logger.warn(`smoke: database check failed: ${this.getErrMsg(err)}`);
      return {
        status: 'fail',
        message: `Database unavailable: ${this.getErrMsg(err)}`,
      };
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    try {
      const healthy = await this.cacheService.checkHealth();
      return healthy
        ? { status: 'ok' }
        : { status: 'warn', message: 'Cache health check returned false' };
    } catch (err) {
      this.logger.warn(`smoke: redis check failed: ${this.getErrMsg(err)}`);
      return {
        status: 'warn',
        message: `Redis unavailable: ${this.getErrMsg(err)}`,
      };
    }
  }

  private async checkHorizon(): Promise<CheckResult> {
    try {
      const healthy = await this.stellarService.checkHealth();
      return healthy
        ? { status: 'ok' }
        : { status: 'warn', message: 'Horizon health check returned false' };
    } catch (err) {
      this.logger.warn(`smoke: horizon check failed: ${this.getErrMsg(err)}`);
      return {
        status: 'warn',
        message: `Horizon unavailable: ${this.getErrMsg(err)}`,
      };
    }
  }

  private async checkContracts(horizonStatus: CheckStatus): Promise<CheckResult> {
    if (horizonStatus === 'fail') {
      return {
        status: 'warn',
        message: 'Horizon unavailable; skipping contract reachability',
      };
    }

    const reachable: string[] = [];
    const unreachable: Array<{ envVar: string; reason: string }> = [];

    for (const def of CONTRACT_DEFS) {
      const id = config.stellar.contracts[def.name as keyof typeof config.stellar.contracts];
      if (!id) {
        continue;
      }
      if (!StrKey.isValidContract(id)) {
        unreachable.push({
          envVar: def.envVar,
          reason: 'invalid contract ID',
        });
        continue;
      }
      try {
        const ok = await this.stellarService.isContractReachable(id);
        if (ok) {
          reachable.push(def.envVar);
        } else {
          unreachable.push({
            envVar: def.envVar,
            reason: 'not reachable on chain',
          });
        }
      } catch (err) {
        unreachable.push({
          envVar: def.envVar,
          reason: this.getErrMsg(err),
        });
      }
    }

    if (unreachable.length === 0) {
      return reachable.length > 0
        ? { status: 'ok' }
        : { status: 'warn', message: 'No contracts configured' };
    }

    return {
      status: 'warn',
      message:
        'Some contracts unreachable: ' +
        unreachable.map((u) => `${u.envVar} (${u.reason})`).join('; '),
    };
  }

  private collectMissing(env: EnvChecks): SmokeReport['missing'] | undefined {
    const requiredConfig: string[] = [];
    if (env.requiredConfig.status !== 'ok') {
      for (const key of REQUIRED_CONFIG) {
        if (!process.env[key] || String(process.env[key]).trim().length === 0) {
          requiredConfig.push(key);
        }
      }
    }

    const requiredSecrets: string[] = [];
    if (env.requiredSecrets.status !== 'ok') {
      for (const key of REQUIRED_SECRETS) {
        if (!process.env[key] || String(process.env[key]).trim().length === 0) {
          requiredSecrets.push(key);
        }
      }
    }

    const contracts: string[] = [];
    if (env.contractConfig.status !== 'ok') {
      for (const def of CONTRACT_DEFS) {
        const raw = process.env[def.envVar];
        if (!raw || String(raw).trim().length === 0) {
          contracts.push(def.envVar);
        }
      }
    }

    const hasAny =
      requiredConfig.length > 0 ||
      requiredSecrets.length > 0 ||
      contracts.length > 0;
    if (!hasAny) return undefined;
    return { requiredConfig, requiredSecrets, contracts };
  }

  private getErrMsg(err: unknown): string {
    return err instanceof Error ? err.message : 'unknown error';
  }
}
