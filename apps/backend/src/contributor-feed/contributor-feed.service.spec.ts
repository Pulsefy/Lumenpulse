import { Test, TestingModule } from '@nestjs/testing';
import { ContributorFeedService } from './contributor-feed.service';
import { FeedActivityType, FeedSortOrder } from './dto/contributor-feed.dto';

describe('ContributorFeedService', () => {
  let service: ContributorFeedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContributorFeedService],
    }).compile();

    service = module.get<ContributorFeedService>(ContributorFeedService);
  });

  describe('recordActivity', () => {
    it('should record an activity and return a DTO', () => {
      const result = service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GABC123',
        githubHandle: 'testuser',
        summary: 'Test user registered',
      });

      expect(result.id).toMatch(/^activity_/);
      expect(result.activityType).toBe(FeedActivityType.CONTRIBUTOR_REGISTERED);
      expect(result.contributorAddress).toBe('GABC123');
      expect(result.githubHandle).toBe('testuser');
      expect(result.summary).toBe('Test user registered');
      expect(result.timestamp).toBeDefined();
    });

    it('should increment activity count', () => {
      expect(service.getActivityCount()).toBe(0);
      service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GABC123',
        summary: 'Registered',
      });
      expect(service.getActivityCount()).toBe(1);
    });
  });

  describe('getFeed', () => {
    beforeEach(() => {
      // Seed some activities
      service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GALICE',
        githubHandle: 'alice',
        summary: 'Alice registered',
      });
      service.recordActivity({
        activityType: FeedActivityType.GRANT_CONTRIBUTION,
        contributorAddress: 'GALICE',
        githubHandle: 'alice',
        summary: 'Alice contributed 100 XLM',
        metadata: { amount: '100' },
      });
      service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GBOB',
        githubHandle: 'bob',
        summary: 'Bob registered',
      });
    });

    it('should return all activities with default pagination', () => {
      const result = service.getFeed({});
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should sort DESC by default (newest first)', () => {
      const result = service.getFeed({});
      const timestamps = result.items.map((i) => i.timestamp);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i] <= timestamps[i - 1]).toBe(true);
      }
    });

    it('should sort ASC when requested', () => {
      const result = service.getFeed({ sortOrder: FeedSortOrder.ASC });
      const timestamps = result.items.map((i) => i.timestamp);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i] >= timestamps[i - 1]).toBe(true);
      }
    });

    it('should filter by activityType', () => {
      const result = service.getFeed({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
      });
      expect(result.items.length).toBe(2);
      expect(
        result.items.every(
          (i) => i.activityType === FeedActivityType.CONTRIBUTOR_REGISTERED,
        ),
      ).toBe(true);
    });

    it('should filter by contributorAddress', () => {
      const result = service.getFeed({ contributorAddress: 'GALICE' });
      expect(result.items.length).toBe(2);
      expect(result.items.every((i) => i.contributorAddress === 'GALICE')).toBe(
        true,
      );
    });

    it('should paginate correctly', () => {
      const page1 = service.getFeed({ page: 1, limit: 2 });
      expect(page1.items.length).toBe(2);
      expect(page1.total).toBe(3);
      expect(page1.totalPages).toBe(2);

      const page2 = service.getFeed({ page: 2, limit: 2 });
      expect(page2.items.length).toBe(1);
      expect(page2.page).toBe(2);
    });

    it('should detect sparse contributors', () => {
      const result = service.getFeed({ contributorAddress: 'GBOB' });
      expect(result.isSparseContributor).toBe(true);
    });

    it('should not flag active contributors as sparse', () => {
      const result = service.getFeed({ contributorAddress: 'GALICE' });
      expect(result.isSparseContributor).toBe(false);
    });

    it('should return empty items for non-matching filter', () => {
      const result = service.getFeed({ contributorAddress: 'GUNKNOWN' });
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(1);
    });

    it('should handle first-time contributors cleanly', () => {
      service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GNEW',
        summary: 'New contributor',
      });
      const result = service.getFeed({ contributorAddress: 'GNEW' });
      expect(result.items.length).toBe(1);
      expect(result.isSparseContributor).toBe(true);
    });
  });

  describe('clearActivities', () => {
    it('should clear all activities', () => {
      service.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GABC',
        summary: 'Test',
      });
      expect(service.getActivityCount()).toBe(1);
      service.clearActivities();
      expect(service.getActivityCount()).toBe(0);
    });
  });

  describe('seedDemoActivities', () => {
    it('should seed demo activities and return count', () => {
      const count = service.seedDemoActivities();
      expect(count).toBeGreaterThan(0);
      expect(service.getActivityCount()).toBe(count);
    });

    it('should seed activities with correct types', () => {
      service.seedDemoActivities();
      const result = service.getFeed({});
      const types = new Set(result.items.map((i) => i.activityType));
      expect(types.has(FeedActivityType.CONTRIBUTOR_REGISTERED)).toBe(true);
      expect(types.has(FeedActivityType.GRANT_CONTRIBUTION)).toBe(true);
    });
  });
});
