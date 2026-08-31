import { Injectable, Logger } from '@nestjs/common';
import {
  ContributorFeedQueryDto,
  ContributorFeedResponseDto,
  FeedActivityItemDto,
  FeedActivityType,
  FeedSortOrder,
} from './dto/contributor-feed.dto';

/**
 * Internal activity record used before pagination.
 */
interface InternalActivity {
  id: string;
  activityType: FeedActivityType;
  contributorAddress: string;
  githubHandle?: string;
  timestamp: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * ContributorFeedService
 *
 * Aggregates contributor-linked actions from multiple domains into a single
 * activity feed. Currently combines:
 *  1. Contributor registration events (contributor-registry domain)
 *  2. Grant contribution events (grants domain)
 *
 * The service holds its own in-memory activity log that is populated by
 * other services calling `recordActivity()` or by the demo bootstrap module.
 * In a production deployment this would be backed by a database view or
 * event store.
 */
@Injectable()
export class ContributorFeedService {
  private readonly logger = new Logger(ContributorFeedService.name);
  private readonly activities: InternalActivity[] = [];
  private nextId = 1;

  /**
   * Record a new activity into the feed.
   * Called by other modules (e.g. contributor-registry, grants) when a
   * contributor-linked action occurs.
   */
  recordActivity(params: {
    activityType: FeedActivityType;
    contributorAddress: string;
    githubHandle?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): FeedActivityItemDto {
    const id = `activity_${String(this.nextId++).padStart(6, '0')}`;
    const timestamp = new Date().toISOString();

    const activity: InternalActivity = {
      id,
      activityType: params.activityType,
      contributorAddress: params.contributorAddress,
      githubHandle: params.githubHandle,
      timestamp,
      summary: params.summary,
      metadata: params.metadata,
    };

    this.activities.push(activity);
    this.logger.log(
      `Feed activity recorded: id=${id} type=${params.activityType} contributor=${params.contributorAddress}`,
    );

    return this.toDto(activity);
  }

  /**
   * GET /contributor-feed
   * Returns a paginated, ordered feed of contributor activities.
   *
   * Supports:
   *  - Pagination (page/limit)
   *  - Stable ordering by timestamp + id
   *  - Filtering by activityType and contributorAddress
   *  - Sparse/first-time contributor detection
   */
  getFeed(query: ContributorFeedQueryDto): ContributorFeedResponseDto {
    const {
      page = 1,
      limit = 20,
      activityType,
      contributorAddress,
      sortOrder = FeedSortOrder.DESC,
    } = query;

    // Filter
    let filtered = [...this.activities];

    if (activityType) {
      filtered = filtered.filter((a) => a.activityType === activityType);
    }

    if (contributorAddress) {
      filtered = filtered.filter(
        (a) => a.contributorAddress === contributorAddress,
      );
    }

    // Stable sort: primary by timestamp, secondary by id for deterministic order
    filtered.sort((a, b) => {
      const tsCompare = a.timestamp.localeCompare(b.timestamp);
      if (tsCompare !== 0) {
        return sortOrder === FeedSortOrder.DESC ? -tsCompare : tsCompare;
      }
      const idCompare = a.id.localeCompare(b.id);
      return sortOrder === FeedSortOrder.DESC ? -idCompare : idCompare;
    });

    const total = filtered.length;
    const effectiveLimit = Math.min(limit, 100);
    const effectivePage = Math.max(page, 1);
    const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));
    const start = (effectivePage - 1) * effectiveLimit;
    const pageItems = filtered.slice(start, start + effectiveLimit);

    // Sparse contributor detection: if filtering by address and they have < 2 activities
    const isSparseContributor = contributorAddress
      ? this.activities.filter(
          (a) => a.contributorAddress === contributorAddress,
        ).length < 2
      : false;

    return {
      items: pageItems.map((a) => this.toDto(a)),
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages,
      isSparseContributor,
    };
  }

  /**
   * Returns the total number of activities in the feed.
   */
  getActivityCount(): number {
    return this.activities.length;
  }

  /**
   * Clears all activities. Used by demo-bootstrap reset.
   */
  clearActivities(): void {
    this.activities.length = 0;
    this.nextId = 1;
    this.logger.log('Feed activities cleared');
  }

  /**
   * Seed some demo activities for the contributor walkthrough.
   */
  seedDemoActivities(): number {
    const now = Date.now();
    const demoActivities: Omit<InternalActivity, 'id' | 'timestamp'>[] = [
      {
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        githubHandle: 'demo-alice',
        summary: 'Contributor demo-alice registered on testnet',
        metadata: { tier: 'Core', reputationScore: 120 },
      },
      {
        activityType: FeedActivityType.GRANT_CONTRIBUTION,
        contributorAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        githubHandle: 'demo-alice',
        summary:
          'demo-alice contributed 1,500 XLM to Stellar Community Builders',
        metadata: {
          roundId: 0,
          projectId: 1,
          amount: '15000000000',
          roundName: 'Stellar Community Builders — Round 1',
        },
      },
      {
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress:
          'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2ABC',
        githubHandle: 'demo-bob',
        summary: 'Contributor demo-bob registered on testnet',
        metadata: { tier: 'Architect', reputationScore: 55 },
      },
      {
        activityType: FeedActivityType.GRANT_CONTRIBUTION,
        contributorAddress:
          'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2ABC',
        githubHandle: 'demo-bob',
        summary: 'demo-bob contributed 500 XLM to Stellar Community Builders',
        metadata: {
          roundId: 0,
          projectId: 1,
          amount: '5000000000',
          roundName: 'Stellar Community Builders — Round 1',
        },
      },
      {
        activityType: FeedActivityType.REPUTATION_CHANGE,
        contributorAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        githubHandle: 'demo-alice',
        summary: 'demo-alice reputation updated: Novice → Core (score: 120)',
        metadata: {
          oldScore: 0,
          newScore: 120,
          oldTier: 'Novice',
          newTier: 'Core',
        },
      },
      {
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress:
          'GCM37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2DEF',
        githubHandle: 'demo-carol',
        summary: 'Contributor demo-carol registered on testnet',
        metadata: { tier: 'Builder', reputationScore: 15 },
      },
    ];

    for (let i = 0; i < demoActivities.length; i++) {
      const demo = demoActivities[i];
      const id = `activity_${String(this.nextId++).padStart(6, '0')}`;
      // Spread timestamps 1 hour apart for stable ordering
      const timestamp = new Date(
        now - (demoActivities.length - i) * 3600 * 1000,
      ).toISOString();

      this.activities.push({
        id,
        ...demo,
        timestamp,
      });
    }

    this.logger.log(`Seeded ${demoActivities.length} demo feed activities`);

    return demoActivities.length;
  }

  private toDto(activity: InternalActivity): FeedActivityItemDto {
    return {
      id: activity.id,
      activityType: activity.activityType,
      contributorAddress: activity.contributorAddress,
      githubHandle: activity.githubHandle,
      timestamp: activity.timestamp,
      summary: activity.summary,
      metadata: activity.metadata,
    };
  }
}
