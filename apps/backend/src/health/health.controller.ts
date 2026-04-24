import { Controller, Get, Res } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

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
}
