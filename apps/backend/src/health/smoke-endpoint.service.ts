import { Injectable } from '@nestjs/common';
import { config } from '../lib/config';
import { ContractHealthService } from './contract-health.service';
import { SmokeEndpointReport, SmokeEnvVarCheck, SmokeContractCheck } from './smoke-endpoint.dto';

const REQUIRED_ENV_VARS_FOR_SMOKE = [
  { name: 'STELLAR_NETWORK', sensitive: false },
  { name: 'STELLAR_HORIZON_URL', sensitive: false },
  { name: 'STELLAR_SOROBAN_RPC_URL', sensitive: false },
  { name: 'STELLAR_SERVER_SECRET', sensitive: true },
] as const;

const CONTRACT_CHECKS = [
  { name: 'lumenToken', envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN' },
  { name: 'crowdfundVault', envVar: 'STELLAR_CONTRACT_CROWDFUND_VAULT' },
  { name: 'projectRegistry', envVar: 'STELLAR_CONTRACT_PROJECT_REGISTRY' },
  { name: 'contributorRegistry', envVar: 'STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY' },
  { name: 'matchingPool', envVar: 'STELLAR_CONTRACT_MATCHING_POOL' },
  { name: 'treasury', envVar: 'STELLAR_CONTRACT_TREASURY' },
] as const;

@Injectable()
export class SmokeEndpointService {
  constructor(private readonly contractHealthService: ContractHealthService) {}

  async getSmokeReport(): Promise<SmokeEndpointReport> {
    const envVars = this.checkRequiredEnvVars();
    const contracts = await this.checkContracts();

    const hasMisconfiguredContracts = contracts.some(
      (c) => c.status === 'misconfigured',
    );
    const allEnvVarsConfigured = envVars.every((e) => e.configured);
    const hasUnreachableContracts = contracts.some(
      (c) => c.status === 'unreachable',
    );

    const status =
      allEnvVarsConfigured && !hasMisconfiguredContracts && !hasUnreachableContracts
        ? 'ok'
        : 'error';

    return {
      status,
      network: config.stellar.network,
      checkedAt: new Date().toISOString(),
      envVars,
      contracts,
    };
  }

  private checkRequiredEnvVars(): SmokeEnvVarCheck[] {
    return REQUIRED_ENV_VARS_FOR_SMOKE.map((check) => {
      const value = process.env[check.name];
      const configured = typeof value === 'string' && value.trim().length > 0;

      return {
        name: check.name,
        configured,
        value: configured
          ? check.sensitive
            ? '[REDACTED]'
            : value
          : undefined,
      };
    });
  }

  private async checkContracts(): Promise<SmokeContractCheck[]> {
    const contractHealthReport =
      await this.contractHealthService.getContractHealthReport();

    return CONTRACT_CHECKS.map((contractCheck): SmokeContractCheck => {
      const found = contractHealthReport.contracts.find(
        (c) => c.name === contractCheck.name,
      );

      if (!found) {
        return {
          name: contractCheck.name,
          envVar: contractCheck.envVar,
          configured: false,
          status: 'misconfigured',
          contractId: undefined,
        };
      }

      return {
        name: found.name,
        envVar: found.envVar,
        configured: found.configured,
        status: found.status,
        contractId: found.contractId,
      };
    });
  }
}