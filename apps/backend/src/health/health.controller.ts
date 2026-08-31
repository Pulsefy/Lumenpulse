import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ContractHealthService } from './contract-health.service';
import { DeploymentSmokeService } from './deployment-smoke.service';
import { HealthService } from './health.service';
import { ShutdownService } from './shutdown.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly contractHealthService: ContractHealthService,
    private readonly deploymentSmokeService: DeploymentSmokeService,
    private readonly shutdownService: ShutdownService,
  ) {}

  @Get('health')
  @HealthCheck()
  @ApiOperation({ summary: 'Returns API health and dependency status' })
  @ApiOkResponse({
    description:
      'Returns a healthy or degraded response when the API is available.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Returns when a critical dependency is unavailable.',
  })
  async getHealth(@Res({ passthrough: true }) response: Response) {
    const healthReport = await this.healthService.getHealthReport();

    response.status(healthReport.status === 'error' ? 503 : 200);

    return healthReport;
  }

  @Get('health/live')
  @HealthCheck()
  @ApiOperation({
    summary:
      'Liveness probe (returns healthy even during graceful shutdown drain)',
  })
  async getLiveness(@Res({ passthrough: true }) response: Response) {
    const healthReport = await this.healthService.getHealthReport();
    response.status(healthReport.status === 'error' ? 503 : 200);
    return healthReport;
  }

  @Get('health/ready')
  @HealthCheck()
  @ApiOperation({
    summary:
      'Readiness probe (returns unready immediately upon shutdown signal)',
  })
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    if (this.shutdownService.isShuttingDown()) {
      throw new ServiceUnavailableException('Service is shutting down');
    }
    const healthReport = await this.healthService.getHealthReport();
    response.status(healthReport.status === 'error' ? 503 : 200);
    return healthReport;
  }

  @Get('health/contracts')
  @ApiOperation({
    summary: 'Reports configured Stellar contract reachability and readiness',
  })
  @ApiOkResponse({
    description:
      'Returns reachable contract status for all configured contract IDs.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Returns when one or more configured contract IDs are missing, invalid, or not callable.',
  })
  async getContractHealth(@Res({ passthrough: true }) response: Response) {
    const healthReport =
      await this.contractHealthService.getContractHealthReport();

    response.status(healthReport.status === 'ok' ? 200 : 503);

    return healthReport;
  }

  @Get('health/latency')
  @ApiOperation({
    summary:
      'Returns latency budget health signals for Horizon and Soroban RPC',
    description:
      'Probes each testnet dependency and classifies response time against ' +
      'configurable thresholds. Returns HTTP 200 for ok/degraded and HTTP 503 ' +
      'when any dependency exceeds its hard-down threshold. ' +
      'Thresholds are set via HEALTH_HORIZON_LATENCY_* and ' +
      'HEALTH_SOROBAN_RPC_LATENCY_* environment variables.',
  })
  @ApiOkResponse({
    description:
      'All dependencies are within their latency budgets, or only degraded.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'At least one dependency has exceeded its hard-down latency threshold.',
  })
  async getLatencyHealth(@Res({ passthrough: true }) response: Response) {
    const report = await this.healthService.getHealthReport();
    const latencyReport = report.latencyBudget;

    response.status(latencyReport.overallState === 'hard_down' ? 503 : 200);

    return latencyReport;
  }

  @Get('health/smoke')
  @ApiOperation({
    summary: 'Deployment smoke check for CI and Vercel',
    description:
      'Single endpoint that confirms the backend and its testnet dependencies ' +
      'are ready to serve. Verifies required environment variables are present, ' +
      'core dependencies (database, Redis, Horizon) respond, and every ' +
      'configured Soroban contract ID is reachable. ' +
      'Returns a machine-readable report: `status` is "pass", "warn" or "fail", ' +
      '`ready` is false only when something failed, and every check carries a ' +
      'stable `id` so CI can assert on individual results. ' +
      'Safe to expose publicly — environment variables are reported by name and ' +
      'presence only, contract IDs are redacted, and dependency errors are ' +
      'replaced with fixed messages so no connection detail can leak.',
  })
  @ApiOkResponse({
    description:
      'All checks passed, or only non-blocking warnings were raised (status ' +
      '"pass" or "warn").',
  })
  @ApiServiceUnavailableResponse({
    description:
      'At least one check failed (status "fail") — the deployment is not ready.',
  })
  async getDeploymentSmoke(@Res({ passthrough: true }) response: Response) {
    const report = await this.deploymentSmokeService.getSmokeReport();

    response.status(report.ready ? 200 : 503);

    return report;
  }
}
