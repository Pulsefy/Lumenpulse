import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityAliasService } from '../entity-alias/entity-alias.service';
import {
  ChartDataPointDto,
  ChartDataQueryDto,
  ChartInterval,
  ChartRange,
} from './dto/chart-data.dto';

interface HourlyRow {
  bucket: Date;
  sentiment: number;
  count: number;
}

interface DailyRow {
  bucket: Date;
  sentiment: number;
  count: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly aliasService: EntityAliasService,
  ) {}

  async getChartData(query: ChartDataQueryDto): Promise<ChartDataPointDto[]> {
    const { interval, range, asset } = query;
    const since = this.getStartDate(range);

    let resolvedAssets: string[] | null = null;
    if (asset) {
      const norm = this.aliasService.normalize(asset, 'asset');
      const variants = this.aliasService.expand(norm.canonical, 'asset');
      resolvedAssets = [...new Set(variants.map((v) => v.toLowerCase()))];
      this.logger.log(
        `Analytics asset "${asset}" normalized to "${norm.canonical}" (${resolvedAssets.length} variants)`,
      );
    }

    this.logger.log(
      `Fetching chart data: interval=${interval}, range=${range}, asset=${asset || 'global'}`,
    );

    if (interval === ChartInterval.ONE_HOUR) {
      return this.getHourlyChartData(since, resolvedAssets);
    } else {
      return this.getDailyChartData(since, resolvedAssets);
    }
  }

  private async getHourlyChartData(
    since: Date,
    assets?: string[] | null,
  ): Promise<ChartDataPointDto[]> {
    const useAssetFilter = assets && assets.length > 0;
    const sql = `
      SELECT 
        date_trunc('hour', analyzed_at) AS bucket,
        AVG(sentiment_score)::float AS sentiment,
        COUNT(*)::int AS count
      FROM news_insights
      WHERE analyzed_at >= $1
        AND (
          ($2::text[] IS NULL OR array_length($2::text[], 1) IS NULL)
          OR LOWER(primary_asset) = ANY($2::text[])
        )
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const results: HourlyRow[] = await this.dataSource.query(sql, [
      since,
      useAssetFilter ? assets : null,
    ]);

    return results.map((row: HourlyRow) => ({
      timestamp: row.bucket.toISOString(),
      sentiment: row.sentiment,
      count: row.count,
    }));
  }

  private async getDailyChartData(
    since: Date,
    assets?: string[] | null,
  ): Promise<ChartDataPointDto[]> {
    const useAssetFilter = assets && assets.length > 0;
    const sql = `
      SELECT 
        snapshot_date AS bucket,
        avg_sentiment::float AS sentiment,
        signal_count::int AS count
      FROM daily_snapshots
      WHERE snapshot_date >= $1
        AND (
          ($2::text[] IS NULL OR array_length($2::text[], 1) IS NULL)
            AND asset_symbol IS NULL
        )
        OR (
          ($2::text[] IS NOT NULL AND array_length($2::text[], 1) IS NOT NULL)
            AND LOWER(asset_symbol) = ANY($2::text[])
        )
      ORDER BY bucket ASC
    `;

    const results: DailyRow[] = await this.dataSource.query(sql, [
      since,
      useAssetFilter ? assets : null,
    ]);

    return results.map((row: DailyRow) => ({
      timestamp: row.bucket.toISOString(),
      sentiment: row.sentiment,
      count: row.count,
    }));
  }

  private getStartDate(range: ChartRange = ChartRange.SEVEN_DAYS): Date {
    const date = new Date();
    const days = range === ChartRange.THIRTY_DAYS ? 30 : 7;
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
}
