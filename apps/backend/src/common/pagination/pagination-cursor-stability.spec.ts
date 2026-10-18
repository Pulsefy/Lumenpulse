/**
 * Cursor stability tests for pagination under concurrent inserts.
 *
 * These tests verify that paginating through a sorted list while new items
 * are concurrently inserted does not cause existing items to shift between
 * pages or duplicate across pages. This is the "cursor stability" contract
 * documented in PAGINATION.md.
 *
 * The ContributorFeedService is used as a representative in-memory model.
 * The same invariants apply to database-backed endpoints because they use a
 * deterministic two-key sort order (timestamp ASC/DESC + id).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ContributorFeedService } from '../../contributor-feed/contributor-feed.service';
import {
  FeedActivityType,
  FeedSortOrder,
} from '../../contributor-feed/dto/contributor-feed.dto';
import { resolvePagination } from './pagination-response.dto';

/**
 * Helper: record N activities with staggered timestamps to simulate
 * a pre-existing dataset.
 */
function seedActivities(
  svc: ContributorFeedService,
  count: number,
  baseMs = 1_700_000_000_000,
): void {
  for (let i = 0; i < count; i++) {
    jest.setSystemTime(new Date(baseMs + i * 1000));
    svc.recordActivity({
      activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
      contributorAddress: `G${String(i).padStart(5, '0')}`,
      summary: `Seed activity ${i}`,
    });
  }
  // Advance time beyond all seeded items so subsequent inserts get newer timestamps
  jest.setSystemTime(new Date(baseMs + count * 1000 + 60_000));
}

describe('Pagination cursor stability (unit)', () => {
  let svc: ContributorFeedService;

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContributorFeedService],
    }).compile();

    svc = module.get<ContributorFeedService>(ContributorFeedService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── resolvePagination unit tests ───────────────────────────────────────────

  describe('resolvePagination', () => {
    it('applies DEFAULT_PAGE=1 when page is undefined', () => {
      const r = resolvePagination(undefined, undefined);
      expect(r.page).toBe(1);
    });

    it('applies DEFAULT_PAGE_SIZE=20 when pageSize is undefined', () => {
      const r = resolvePagination(undefined, undefined);
      expect(r.pageSize).toBe(20);
    });

    it('clamps pageSize to MAX_PAGE_SIZE=100', () => {
      const r = resolvePagination(1, 999);
      expect(r.pageSize).toBe(100);
    });

    it('clamps page to minimum of 1', () => {
      const r = resolvePagination(0, 10);
      expect(r.page).toBe(1);
    });

    it('computes offset correctly', () => {
      const r = resolvePagination(3, 10);
      expect(r.offset).toBe(20); // (3-1) * 10
    });

    it('offset is 0 on page 1', () => {
      const r = resolvePagination(1, 20);
      expect(r.offset).toBe(0);
    });
  });

  // ── Stable page order ──────────────────────────────────────────────────────

  describe('stable page order', () => {
    it('items on page N do not change when new items are inserted AFTER them', () => {
      // Seed 10 items with old timestamps
      seedActivities(svc, 10);

      // Capture page 1 (oldest-first / ASC) before any insert
      const before = svc.getFeed({
        page: 1,
        pageSize: 5,
        sortOrder: FeedSortOrder.ASC,
      });
      const beforeIds = before.items.map((i) => i.id);

      // Insert a NEW item with a fresh (later) timestamp — simulates concurrent insert
      svc.recordActivity({
        activityType: FeedActivityType.GRANT_CONTRIBUTION,
        contributorAddress: 'GNEW',
        summary: 'New concurrent insert',
      });

      // Re-fetch page 1 (same params)
      const after = svc.getFeed({
        page: 1,
        pageSize: 5,
        sortOrder: FeedSortOrder.ASC,
      });
      const afterIds = after.items.map((i) => i.id);

      // Page 1 must be unchanged — the new item should appear on a later page
      expect(afterIds).toEqual(beforeIds);
    });

    it('no item appears on two pages simultaneously', () => {
      seedActivities(svc, 15);

      const pageSize = 5;
      const seenIds = new Set<string>();

      for (let p = 1; p <= 3; p++) {
        const result = svc.getFeed({
          page: p,
          pageSize,
          sortOrder: FeedSortOrder.DESC,
        });
        for (const item of result.items) {
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);
        }
      }
    });

    it('all seeded items are eventually reachable across pages', () => {
      const SEED = 17;
      seedActivities(svc, SEED);

      const pageSize = 5;
      const allIds = new Set<string>();

      const first = svc.getFeed({ page: 1, pageSize });
      const totalPages = first.totalPages;
      for (const item of first.items) allIds.add(item.id);

      for (let p = 2; p <= totalPages; p++) {
        const result = svc.getFeed({ page: p, pageSize });
        for (const item of result.items) allIds.add(item.id);
      }

      expect(allIds.size).toBe(SEED);
    });
  });

  // ── Concurrent inserts ─────────────────────────────────────────────────────

  describe('concurrent inserts', () => {
    it('items inserted between page fetches appear on a LATER page, not the current one', () => {
      // 20 items with old timestamps (seeded with a past base time)
      seedActivities(svc, 20, 1_600_000_000_000);

      const pageSize = 10;

      // Simulate reading page 2 (the "already-scrolled" page) …
      const page2Before = svc.getFeed({
        page: 2,
        pageSize,
        sortOrder: FeedSortOrder.ASC, // oldest first — stable order for seeded items
      });
      const page2Ids = new Set(page2Before.items.map((i) => i.id));

      // … then a concurrent insert happens (default timestamp = now, which is later)
      svc.recordActivity({
        activityType: FeedActivityType.REPUTATION_CHANGE,
        contributorAddress: 'GCONCURRENT',
        summary: 'Inserted while client was paging',
      });

      // … then page 1 is fetched (oldest-first ASC keeps seeded items on page 1)
      const page1After = svc.getFeed({
        page: 1,
        pageSize,
        sortOrder: FeedSortOrder.ASC,
      });

      // No page-2 (old items) id should be on page 1
      for (const item of page1After.items) {
        expect(page2Ids.has(item.id)).toBe(false);
      }
    });

    it('total increases by 1 after a single insert', () => {
      seedActivities(svc, 5);

      const before = svc.getFeed({});
      const totalBefore = before.total;

      svc.recordActivity({
        activityType: FeedActivityType.CONTRIBUTOR_REGISTERED,
        contributorAddress: 'GNEW2',
        summary: 'Another insert',
      });

      const after = svc.getFeed({});
      expect(after.total).toBe(totalBefore + 1);
    });

    it('totalPages is recalculated correctly after inserts push beyond a page boundary', () => {
      const pageSize = 5;
      seedActivities(svc, 10); // 10 items → 2 pages

      const before = svc.getFeed({ pageSize });
      expect(before.totalPages).toBe(2);

      // Insert 1 more to stay at 11 → still 3 pages
      svc.recordActivity({
        activityType: FeedActivityType.GRANT_CONTRIBUTION,
        contributorAddress: 'GBOUNDARY',
        summary: 'Pushes to next page',
      });

      const after = svc.getFeed({ pageSize });
      expect(after.totalPages).toBe(3);
    });
  });

  // ── Server-side enforcement ────────────────────────────────────────────────

  describe('server-side size enforcement', () => {
    it('pageSize is clamped to 100 even if a larger value sneaks through', () => {
      seedActivities(svc, 5);
      // Manually pass an oversized pageSize bypassing class-validator
      const r = svc.getFeed({ page: 1, pageSize: 9999 });
      expect(r.pageSize).toBe(100);
    });

    it('page defaults to 1 when not provided', () => {
      seedActivities(svc, 3);
      const r = svc.getFeed({});
      expect(r.page).toBe(1);
    });

    it('pageSize defaults to 20 when not provided', () => {
      seedActivities(svc, 3);
      const r = svc.getFeed({});
      expect(r.pageSize).toBe(20);
    });

    it('totalPages is always at least 1 even for empty result sets', () => {
      const r = svc.getFeed({ contributorAddress: 'GNOTEXIST' });
      expect(r.totalPages).toBeGreaterThanOrEqual(1);
    });
  });
});
