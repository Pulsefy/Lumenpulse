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
import { SmokeEndpointService } from './smoke-endpoint.service';
import { SmokeEndpointReport } from './smoke-endpoint.dto';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly contractHealthService: ContractHealthService,
    private readonly smokeEndpointService: SmokeEndpointService,
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

  @Get('smoke')
  @ApiOperation({
    summary: 'Deployment smoke endpoint for CI/Vercel checks',
    description:
      'Verifies environment variables are present and contract IDs are reachable. ' +
      'Returns machine-readable status suitable for CI monitoring. ' +
      'Safe to expose publicly - no secrets are leaked.',
  })
  @ApiOkResponse({
    description: 'Smoke check passed - all dependencies ready',
    type: SmokeEndpointReport,
  })
  @ApiServiceUnavailableResponse({
    description: 'Smoke check failed - missing or unreachable dependencies',
  })
  async getSmoke(@Res({ passthrough: true }) response: Response) {
    const smokeReport = await this.smokeEndpointService.getSmokeReport();

    response.status(smokeReport.status === 'ok' ? 200 : 503);

    return smokeReport;
  }
}
