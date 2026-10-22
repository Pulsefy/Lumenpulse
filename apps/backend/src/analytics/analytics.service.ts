import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ChartDataPointDto,
  ChartDataQueryDto,
  ChartInterval,
  ChartMetaDto,
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

export interface ProductEventRow {
  id: string;
  event_name: string;
  screen_name: string | null;
  properties: Record<string, unknown> | null;
  platform: string;
  app_version: string | null;
  occurred_at: Date;
  received_at: Date;
}

export interface RecordProductEventInput {
  eventName: string;
  screenName?: string;
  properties?: Record<string, unknown>;
  platform?: string;
  appVersion?: string;
  occurredAt?: Date;
}

export interface ProductEventSummary {
  eventName: string;
  count: number;
}

const PRIMITIVE_EVENT_PREFIXES = ['screen_view', 'contribution_'];

const FORBIDDEN_PROPERTY_KEYS = new Set([
  'address',
  'wallet',
  'wallet_address',
  'public_key',
  'publickey',
  'secret',
  'secret_key',
  'private_key',
  'privatekey',
  'email',
  'phone',
  'ip',
  'ip_address',
  'device_id',
]);

function isForbiddenPropertyKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s-]/g, '_');
  if (FORBIDDEN_PROPERTY_KEYS.has(normalized)) {
    return true;
  }
  return (
    normalized.includes('address') ||
    normalized.includes('wallet') ||
    normalized.includes('email') ||
    normalized.includes('private_key') ||
    normalized.includes('secret')
  );
}

function sanitizeProperties(
  props?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!props) {
    return null;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (isForbiddenPropertyKey(key)) {
      continue;
    }
    if (typeof value === 'string') {
      // Drop long opaque identifiers that could be a wallet address.
      if (/^0x[a-z0-9]{20,}$/i.test(value)) {
        continue;
      }
      cleaned[key] = value.slice(0, 256);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Describes the series returned by getChartData so clients can render
   * labels, axes and range options without hard-coding them.
   */
  getChartMeta(): ChartMetaDto {
    return {
      xAxis: { id: 'timestamp', label: 'Time (UTC)' },
      yAxes: [
        { id: 'sentiment', label: 'Average sentiment (-1 to 1)' },
        { id: 'count', label: 'Signals analysed' },
      ],
      series: [
        { key: 'sentiment', label: 'Average sentiment', axisId: 'sentiment' },
        { key: 'count', label: 'Signal count', axisId: 'count' },
      ],
      ranges: [
        {
          range: ChartRange.SEVEN_DAYS,
          label: 'Last 7 days',
          interval: ChartInterval.ONE_HOUR,
        },
        {
          range: ChartRange.THIRTY_DAYS,
          label: 'Last 30 days',
          interval: ChartInterval.ONE_DAY,
        },
      ],
    };
  }

  async getChartData(query: ChartDataQueryDto): Promise<ChartDataPointDto[]> {
    const { interval, range, asset } = query;
    const since = this.getStartDate(range);

    this.logger.log(
      `Fetching chart data: interval=${interval}, range=${range}, asset=${asset || 'global'}`,
    );

    if (interval === ChartInterval.ONE_HOUR) {
      return this.getHourlyChartData(since, asset);
    } else {
      return this.getDailyChartData(since, asset);
    }
  }

  /**
   * Persists a product analytics event emitted by the mobile app.
   * Personally identifying data and wallet addresses are stripped before write.
   */
  async recordProductEvent(
    input: RecordProductEventInput,
  ): Promise<{ id: string }> {
    const eventName = input.eventName?.trim();
    if (!eventName) {
      throw new Error('eventName is required');
    }

    const safeProperties = sanitizeProperties(input.properties);
    const occurredAt = input.occurredAt?.toISOString() || new Date().toISOString();

    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO product_events
         (event_name, screen_name, properties, platform, app_version, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        eventName,
        input.screenName ?? null,
        safeProperties ? JSON.stringify(safeProperties) : null,
        input.platform ?? 'mobile',
        input.appVersion ?? null,
        occurredAt,
      ],
    );

    return { id: rows[0].id };
  }

  /**
   * Returns event counts for the given window, ordered by volume.
   * Used by the dashboard to surface the taxonomy actually in use.
   */
  async getProductEventSummary(
    since?: Date,
  ): Promise<ProductEventSummary[]> {
    const sinceDate = since ?? this.getStartDate(ChartRange.THIRTY_DAYS);
    const rows: Array<{ event_name: string; count: string }> =
      await this.dataSource.query(
        `SELECT event_name, COUNT(*::text AS count
         FROM product_events
         WHERE occurred_at >= $1
         GROUP BY event_name
         ORDER BY count DESC`,
        [sinceDate],
      );

    return rows.map((row) => ({
      eventName: row.event_name,
      count: Number(row.count),
    }));
  }

  /**
   * Returns the canonical product event taxonomy so clients and the webapp
   * can adopt the same event names.
   */
  getProductEventTaxonomy(): {
    events: Array<{ name: string; description: string; category: string }>;
  } {
    return {
      events: [
        { name: 'screen_view', description: 'A screen was opened', category: 'navigation' },
        {
          name: 'contribution_flow_started',
          description: 'User entered the contribution flow',
          category: 'contribution',
        },
        {
          name: 'contribution_amount_selected',
          description: 'User selected a contribution amount',
          category: 'contribution',
        },
        {
          name: 'contribution_review_shown',
          description: 'Review step was shown before confirmation',
          category: 'contribution',
        },
        {
          name: 'contribution_submitted',
          description: 'User submitted the contribution',
          category: 'contribution',
        },
        {
          name: 'contribution_confirmed',
          description: 'Contribution was confirmed on-chain',
          category: 'contribution',
        },
        {
          name: 'contribution_failed',
          description: 'Contribution failed or was abandoned',
          category: 'contribution',
        },
        {
          name: 'wave9_feature_viewed',
          description: 'A Wave 9 feature surface was viewed',
          category: 'feature',
        },
        {
          name: 'wave9_feature_activated',
          description: 'A Wave 9 feature was activated',
          category: 'feature',
        },
      ],
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
    const now = new Date();
    const days = range === ChartRange.THIRTY_DAYS ? 30 : 7;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return start;
  }
}
