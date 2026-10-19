import { Controller, Get, Query, Logger, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swgger';
import { AnalyticsService } from './analytics.service';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit.config';
import {
  ChartDataQueryDto,
  ChartDataPointDto,
  ChartMetaDto,
} from './dto/chart-data.dto';
import { TrackEventsArgDo } from './dto/track-events.dto';
import { EventTaxonomyDto } from './dto/event-taxonomy.dto';
import { ProductAnalyticsService } from './product-analytics.service';

@ApiTags('analytics')
@Controller('analytics')
@RateLimitPolicy('analyticsRead')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly productAnalyticsService: ProductAnalyticsService,
  ) {}

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

  @Get('events/taxonomy')
  @ApiOperation({
    summary: 'Get the product analytics event taxonomy',
    description:
      'Returns the canonical event names and properties shared between mobile and webapp. No personally identifying data or wallet addresses are collected.',
  })
  @ApiResponse({
    status: 200,
    description: 'Product analytics event taxonomy',
    type: EventTaxonomyDto,
  })
  getEventTaxonomy(): EventTaxonomyDto {
    return this.productAnalyticsService.getTaxonomy();
  }

  @Post('events')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Ingest batched product analytics events',
    description:
      'Accepts a batch of anonymous product events from mobile or webapp. Events are validated against the committed taxonomy and stripped of any personally identifying data or wallet addresses.',
  })
  @ApiResponse({
    status: 202,
    description: 'Events accepted for processing',
  })
  async trackEvents(
    @Body() body: TrackEventsArgDo,
    @Headers('x-analytics-opt-out') optOutHeader?: string,
  ): Promise<{ accepted: number }> {
    const optedOut = optOutHeader?.toLowerCase() === 'true';
    if (optedOut) {
      this.logger.debug('Analytics events dropped: client opted out');
      return { accepted: 0 };
    }
    const accepted = await this.productAnalyticsService.ingest(body.events);
    return { accepted };
  }
}
