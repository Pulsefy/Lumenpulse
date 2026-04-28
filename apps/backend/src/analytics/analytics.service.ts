import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ChartDataPointDto,
  ChartDataQueryDto,
  ChartDataResponseDto,
  ChartInterval,
  ChartRange,
} from './dto/chart-data.dto';
import { SortOrder } from '../common/dto/cursor-pagination.dto';

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

  constructor(private readonly dataSource: DataSource) {}

  async getChartData(query: ChartDataQueryDto): Promise<ChartDataResponseDto> {
    const { interval, range, asset } = query;
    const since = this.getStartDate(range);
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? SortOrder.DESC;
    const cursor = query.cursor;

    this.logger.log(
      `Fetching chart data: interval=${interval}, range=${range}, asset=${asset || 'global'}`,
    );

    const rows =
      interval === ChartInterval.ONE_HOUR
        ? await this.getHourlyChartData(since, asset)
        : await this.getDailyChartData(since, asset);

    const sorted = [...rows].sort((a, b) => {
      const aTs = new Date(a.timestamp).getTime();
      const bTs = new Date(b.timestamp).getTime();
      return sortOrder === SortOrder.ASC ? aTs - bTs : bTs - aTs;
    });

    const filtered = cursor
      ? sorted.filter((row) => {
          const ts = new Date(row.timestamp).getTime();
          const cursorTs = new Date(cursor).getTime();
          return sortOrder === SortOrder.ASC ? ts > cursorTs : ts < cursorTs;
        })
      : sorted;

    const items = filtered.slice(0, limit);
    const nextCursor = items.length > 0 ? items[items.length - 1].timestamp : undefined;

    return {
      items,
      total: sorted.length,
      limit,
      sortOrder,
      nextCursor,
    };
  }

  private async getHourlyChartData(
    since: Date,
    asset?: string,
  ): Promise<ChartDataPointDto[]> {
    // news_insights table has analyzed_at and sentiment_score
    // Group by hour using date_trunc
    const sql = `
      SELECT 
        date_trunc('hour', analyzed_at) AS bucket,
        AVG(sentiment_score)::float AS sentiment,
        COUNT(*)::int AS count
      FROM news_insights
      WHERE analyzed_at >= $1
        AND ($2::text IS NULL OR primary_asset = $2)
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const results: HourlyRow[] = await this.dataSource.query(sql, [
      since,
      asset || null,
    ]);

    return results.map((row: HourlyRow) => ({
      timestamp: row.bucket.toISOString(),
      sentiment: row.sentiment,
      count: row.count,
    }));
  }

  private async getDailyChartData(
    since: Date,
    asset?: string,
  ): Promise<ChartDataPointDto[]> {
    // daily_snapshots table has snapshot_date, avg_sentiment, signal_count
    // It already has a global row (asset_symbol IS NULL) for each day
    const sql = `
      SELECT 
        snapshot_date AS bucket,
        avg_sentiment::float AS sentiment,
        signal_count::int AS count
      FROM daily_snapshots
      WHERE snapshot_date >= $1
        AND (
          ($2::text IS NULL AND asset_symbol IS NULL) OR 
          (asset_symbol = $2)
        )
      ORDER BY bucket ASC
    `;

    const results: DailyRow[] = await this.dataSource.query(sql, [
      since,
      asset || null,
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
