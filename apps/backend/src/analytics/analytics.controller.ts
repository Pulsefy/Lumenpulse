import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from './analytics.service';
import { getAnalyticsReadThrottleOverride } from '../common/rate-limit/rate-limit.config';
import { ChartDataQueryDto, ChartDataPointDto } from './dto/chart-data.dto';

@ApiTags('analytics')
@Controller('analytics')
@Throttle(getAnalyticsReadThrottleOverride())
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('chart-data')
  @ApiOperation({
    summary: 'Get bucketed sentiment/chart data',
    description:
      'Returns sentiment data bucketed by hour or day for time-series charts (e.g., Recharts).',
  })
  @ApiResponse({
    status: 200,
    description: 'Bucketed sentiment data',
    type: ChartDataPointDto,
    isArray: true,
  })
  async getChartData(
    @Query() query: ChartDataQueryDto,
  ): Promise<ChartDataPointDto[]> {
    return this.analyticsService.getChartData(query);
  }
}
