import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContentReport,
  ReportStatus,
} from '../moderation/entities/content-report.entity';
import {
  PortfolioAnomaly,
  PortfolioAnomalyStatus,
} from '../portfolio/entities/portfolio-anomaly.entity';
import {
  AgingBucket,
  DomainAgingSnapshot,
  ReviewDomain,
  ReviewMetricsQueryDto,
  ReviewMetricsResponseDto,
} from './dto/review-metrics.dto';

/**
 * Predefined aging buckets expressed as [minHours, maxHours).
 * The last bucket uses Infinity for an open upper bound.
 */
const AGING_BUCKETS: {
  label: string;
  minHours: number;
  maxHours: number | null;
}[] = [
  { label: '< 1 hour', minHours: 0, maxHours: 1 },
  { label: '1–6 hours', minHours: 1, maxHours: 6 },
  { label: '6–24 hours', minHours: 6, maxHours: 24 },
  { label: '1–3 days', minHours: 24, maxHours: 72 },
  { label: '3–7 days', minHours: 72, maxHours: 168 },
  { label: '> 7 days', minHours: 168, maxHours: null },
];

/**
 * Internal representation of a single open item used for aging calculations.
 */
interface OpenItem {
  createdAt: Date;
}

@Injectable()
export class ReviewMetricsService {
  private readonly logger = new Logger(ReviewMetricsService.name);

  constructor(
    @InjectRepository(ContentReport)
    private readonly reportsRepo: Repository<ContentReport>,
    @InjectRepository(PortfolioAnomaly)
    private readonly anomaliesRepo: Repository<PortfolioAnomaly>,
  ) {}

  /** Top-level entry point exposed to the controller. */
  async getReviewMetrics(
    query: ReviewMetricsQueryDto,
  ): Promise<ReviewMetricsResponseDto> {
    const domains: DomainAgingSnapshot[] = [];

    if (!query.domain || query.domain === ReviewDomain.MODERATION) {
      const items = await this.fetchModerationOpenItems(query);
      domains.push(this.buildDomainSnapshot(ReviewDomain.MODERATION, items));
    }

    if (!query.domain || query.domain === ReviewDomain.ANOMALY) {
      const items = await this.fetchAnomalyOpenItems(query);
      domains.push(this.buildDomainSnapshot(ReviewDomain.ANOMALY, items));
    }

    const grandTotalOpen = domains.reduce(
      (sum, domain) => sum + domain.totalOpen,
      0,
    );

    return {
      computedAt: new Date().toISOString(),
      domains,
      grandTotalOpen,
    };
  }

  // ── Data fetching ──────────────────────────────────────────────────────

  private async fetchModerationOpenItems(
    query: ReviewMetricsQueryDto,
  ): Promise<OpenItem[]> {
    const qb = this.reportsRepo
      .createQueryBuilder('report')
      .select('report.createdAt', 'createdAt')
      .where('report.status IN (:...openStatuses)', {
        openStatuses: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW],
      });

    if (query.moderationStatus) {
      qb.andWhere('report.status = :status', {
        status: query.moderationStatus,
      });
    }

    if (query.reviewerId) {
      qb.andWhere('report.reviewerId = :reviewerId', {
        reviewerId: query.reviewerId,
      });
    }

    const rows = await qb.getRawMany<{ createdAt: string }>();
    return rows.map((row) => ({ createdAt: new Date(row.createdAt) }));
  }

  private async fetchAnomalyOpenItems(
    query: ReviewMetricsQueryDto,
  ): Promise<OpenItem[]> {
    const qb = this.anomaliesRepo
      .createQueryBuilder('anomaly')
      .select('anomaly.createdAt', 'createdAt')
      .where('anomaly.status IN (:...openStatuses)', {
        openStatuses: [PortfolioAnomalyStatus.UNRESOLVED],
      });

    if (query.anomalyStatus) {
      qb.andWhere('anomaly.status = :status', {
        status: query.anomalyStatus,
      });
    }

    if (query.reviewerId) {
      qb.andWhere('anomaly.reviewerId = :reviewerId', {
        reviewerId: query.reviewerId,
      });
    }

    const rows = await qb.getRawMany<{ createdAt: string }>();
    return rows.map((row) => ({ createdAt: new Date(row.createdAt) }));
  }

  // ── Metric computation ─────────────────────────────────────────────────

  private buildDomainSnapshot(
    domain: ReviewDomain,
    items: OpenItem[],
  ): DomainAgingSnapshot {
    const now = Date.now();
    const agesMs = items.map((item) => now - item.createdAt.getTime());

    const totalOpen = items.length;
    const averageAgeMs =
      totalOpen > 0
        ? Math.round(agesMs.reduce((sum, age) => sum + age, 0) / totalOpen)
        : 0;

    const sorted = [...agesMs].sort((a, b) => a - b);
    const medianAgeMs =
      totalOpen > 0
        ? sorted.length % 2 === 1
          ? sorted[Math.floor(sorted.length / 2)]
          : Math.round(
              (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
            )
        : null;

    const oldestAgeMs = totalOpen > 0 ? sorted[sorted.length - 1] : null;
    const newestAgeMs = totalOpen > 0 ? sorted[0] : null;

    const buckets = this.buildBuckets(agesMs);

    return {
      domain,
      totalOpen,
      averageAgeMs,
      medianAgeMs,
      oldestAgeMs,
      newestAgeMs,
      buckets,
    };
  }

  private buildBuckets(agesMs: number[]): AgingBucket[] {
    return AGING_BUCKETS.map(({ label, minHours, maxHours }) => {
      const minMs = minHours * 3_600_000;
      const maxMs = maxHours !== null ? maxHours * 3_600_000 : null;
      const count = agesMs.filter((age) => {
        if (age < minMs) return false;
        if (maxMs === null) return true;
        return age < maxMs;
      }).length;
      return { label, minHours, maxHours, count };
    });
  }
}
