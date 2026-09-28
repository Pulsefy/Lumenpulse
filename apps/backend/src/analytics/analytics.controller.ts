import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit.config';
import {
  ChartDataQueryDto,
  ChartDataPointDto,
  ChartMetaDto,
} from './dto/chart-data.dto';

@ApiTags('analytics')
@Controller('analytics')
@RateLimitPolicy('analyticsRead')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('chart-meta')
  @ApiOperation({
    summary: 'Describe the chart series',
    description:
      'Returns series, axis and time-range labels for the data served by /analytics/chart-data.',
  })
  @ApiResponse({
    status: 200,
    description: 'Chart series metadata',
    type: ChartMetaDto,
  })
  getChartMeta(): ChartMetaDto {
    return this.analyticsService.getChartMeta();
  }

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
