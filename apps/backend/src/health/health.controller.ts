import { Controller, Get, Res } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ContractHealthService } from './contract-health.service';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly contractHealthService: ContractHealthService,
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
}
