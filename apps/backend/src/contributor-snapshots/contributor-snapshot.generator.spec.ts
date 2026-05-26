import { Test, TestingModule } from '@nestjs/testing';
import { ContributorSnapshotGenerator } from './contributor-snapshot.generator';
import { ContributorSnapshotRepository } from './contributor-snapshot.repository';
import { ContributorAggregation } from './dto/contributor-snapshot.dto';

const makeAgg = (
  overrides: Partial<ContributorAggregation> = {},
): ContributorAggregation => ({
  contributorAddress: 'GABC1234',
  githubHandle: 'alice',
  reputationScore: 100,
  registeredTimestamp: 1_700_000_000,
  ...overrides,
});

const TODAY = new Date('2026-05-25T00:00:00.000Z');
const YESTERDAY = new Date('2026-05-24T00:00:00.000Z');

const mockRepo = () => ({
  aggregateForDate: jest.fn(),
  upsertSnapshots: jest.fn(),
  findTopN: jest.fn(),
});

describe('ContributorSnapshotGenerator', () => {
  let generator: ContributorSnapshotGenerator;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributorSnapshotGenerator,
        { provide: ContributorSnapshotRepository, useFactory: mockRepo },
      ],
    }).compile();

    generator = module.get(ContributorSnapshotGenerator);
    repo = module.get(ContributorSnapshotRepository);
  });

  afterEach(() => jest.clearAllMocks());

  describe('generateForDate', () => {
    it('aggregates and upserts rows', async () => {
      const aggs = [makeAgg(), makeAgg({ contributorAddress: 'GXYZ5678', githubHandle: 'bob', reputationScore: 200 })];
      repo.aggregateForDate.mockResolvedValue(aggs);
      repo.upsertSnapshots.mockResolvedValue(2);

      const result = await generator.generateForDate(TODAY);

      expect(repo.aggregateForDate).toHaveBeenCalledWith(TODAY);
      expect(repo.upsertSnapshots).toHaveBeenCalledWith(TODAY, aggs);
      expect(result.rowsWritten).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('strips time component and uses UTC midnight', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const noonUtc = new Date('2026-05-25T12:34:56.000Z');
      await generator.generateForDate(noonUtc);

      const calledWith: Date = repo.aggregateForDate.mock.calls[0][0];
      expect(calledWith.getUTCHours()).toBe(0);
      expect(calledWith.getUTCMinutes()).toBe(0);
      expect(calledWith.getUTCSeconds()).toBe(0);
      expect(calledWith.getUTCMilliseconds()).toBe(0);
    });

    it('skips upsert and returns zero rows when no data exists', async () => {
      repo.aggregateForDate.mockResolvedValue([]);

      const result = await generator.generateForDate(TODAY);

      expect(repo.upsertSnapshots).not.toHaveBeenCalled();
      expect(result.rowsWritten).toBe(0);
    });

    it('propagates repository errors', async () => {
      repo.aggregateForDate.mockRejectedValue(new Error('db gone'));

      await expect(generator.generateForDate(TODAY)).rejects.toThrow('db gone');
      expect(repo.upsertSnapshots).not.toHaveBeenCalled();
    });

    it('handles contributors with null github handle', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg({ githubHandle: null })]);
      repo.upsertSnapshots.mockResolvedValue(1);

      await generator.generateForDate(TODAY);

      const upsertArg: ContributorAggregation[] = repo.upsertSnapshots.mock.calls[0][1];
      expect(upsertArg[0].githubHandle).toBeNull();
    });

    it('handles contributors with null registeredTimestamp', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg({ registeredTimestamp: null })]);
      repo.upsertSnapshots.mockResolvedValue(1);

      await generator.generateForDate(TODAY);

      const upsertArg: ContributorAggregation[] = repo.upsertSnapshots.mock.calls[0][1];
      expect(upsertArg[0].registeredTimestamp).toBeNull();
    });
  });

  describe('generateForYesterday', () => {
    it('calls generateForDate with yesterday UTC', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const spy = jest.spyOn(generator, 'generateForDate');
      await generator.generateForYesterday();

      const calledDate: Date = spy.mock.calls[0][0];
      const now = new Date();
      const expectedYesterday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
      );

      expect(calledDate.toISOString().split('T')[0]).toBe(
        expectedYesterday.toISOString().split('T')[0],
      );
    });
  });

  describe('backfill', () => {
    it('generates one snapshot per day in the range', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const from = new Date('2026-05-01T00:00:00.000Z');
      const to = new Date('2026-05-03T00:00:00.000Z');

      const results = await generator.backfill(from, to);

      expect(results).toHaveLength(3);
      expect(repo.aggregateForDate).toHaveBeenCalledTimes(3);

      const dates = results.map((r) => r.date.toISOString().split('T')[0]);
      expect(dates).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    });

    it('returns single result when from === to', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAgg()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const results = await generator.backfill(TODAY, TODAY);
      expect(results).toHaveLength(1);
    });

    it('returns empty array when from > to', async () => {
      const results = await generator.backfill(TODAY, YESTERDAY);
      expect(results).toHaveLength(0);
      expect(repo.aggregateForDate).not.toHaveBeenCalled();
    });

    it('accumulates results across days including empty days', async () => {
      repo.aggregateForDate
        .mockResolvedValueOnce([makeAgg()])
        .mockResolvedValueOnce([]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const from = new Date('2026-05-01T00:00:00.000Z');
      const to = new Date('2026-05-02T00:00:00.000Z');

      const results = await generator.backfill(from, to);

      expect(results[0].rowsWritten).toBe(1);
      expect(results[1].rowsWritten).toBe(0);
    });
  });
});
