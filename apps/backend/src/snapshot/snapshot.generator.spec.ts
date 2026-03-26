import { Test, TestingModule } from '@nestjs/testing';
import { AssetAggregation } from './dto/snapshot.dto';
import { SnapshotGenerator } from './snapshot.generator';
import { SnapshotRepository } from './snapshot.repository';

const makeAggregation = (
  overrides: Partial<AssetAggregation> = {},
): AssetAggregation => ({
  assetSymbol: 'BTC',
  avgSentiment: 0.65,
  minSentiment: 0.1,
  maxSentiment: 0.95,
  signalCount: 42,
  totalVolume: 1_000_000,
  volumeWeightedSentiment: 0.68,
  ...overrides,
});

const globalAggregation = (): AssetAggregation =>
  makeAggregation({ assetSymbol: null });

const TODAY = new Date('2024-06-15T00:00:00.000Z');
const YESTERDAY = new Date('2024-06-14T00:00:00.000Z');

const mockSnapshotRepo = () => ({
  aggregateForDate: jest.fn(),
  upsertSnapshots: jest.fn(),
  findByDate: jest.fn(),
  findByAssetAndDateRange: jest.fn(),
});

describe('SnapshotGenerator', () => {
  let generator: SnapshotGenerator;
  let repo: ReturnType<typeof mockSnapshotRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnapshotGenerator,
        { provide: SnapshotRepository, useFactory: mockSnapshotRepo },
      ],
    }).compile();

    generator = module.get(SnapshotGenerator);
    repo = module.get(SnapshotRepository);
  });

  afterEach(() => jest.clearAllMocks());

  describe('generateForDate', () => {
    it('aggregates and upserts per-asset and global rows', async () => {
      const aggs = [
        makeAggregation(),
        makeAggregation({ assetSymbol: 'ETH' }),
        globalAggregation(),
      ];
      repo.aggregateForDate.mockResolvedValue(aggs);
      repo.upsertSnapshots.mockResolvedValue(3);

      const result = await generator.generateForDate(TODAY);

      expect(repo.aggregateForDate).toHaveBeenCalledWith(TODAY);
      expect(repo.upsertSnapshots).toHaveBeenCalledWith(TODAY, aggs);
      expect(result.assetRowsWritten).toBe(2);
      expect(result.globalRowWritten).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('strips time component and uses UTC midnight', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAggregation()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const noonUtc = new Date('2024-06-15T12:34:56.000Z');
      await generator.generateForDate(noonUtc);

      const calledWith: Date = repo.aggregateForDate.mock.calls[0][0];
      expect(calledWith.getUTCHours()).toBe(0);
      expect(calledWith.getUTCMinutes()).toBe(0);
      expect(calledWith.getUTCSeconds()).toBe(0);
      expect(calledWith.getUTCMilliseconds()).toBe(0);
    });

    it('skips upsert and returns zeros when no signals exist', async () => {
      repo.aggregateForDate.mockResolvedValue([]);

      const result = await generator.generateForDate(TODAY);

      expect(repo.upsertSnapshots).not.toHaveBeenCalled();
      expect(result.assetRowsWritten).toBe(0);
      expect(result.globalRowWritten).toBe(false);
    });

    it('handles a day with only global row (no per-asset rows)', async () => {
      repo.aggregateForDate.mockResolvedValue([globalAggregation()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const result = await generator.generateForDate(TODAY);

      expect(result.assetRowsWritten).toBe(0);
      expect(result.globalRowWritten).toBe(true);
    });

    it('handles a day with only per-asset rows (no global)', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAggregation()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const result = await generator.generateForDate(TODAY);

      expect(result.assetRowsWritten).toBe(1);
      expect(result.globalRowWritten).toBe(false);
    });

    it('propagates repository errors', async () => {
      repo.aggregateForDate.mockRejectedValue(new Error('db connection lost'));

      await expect(generator.generateForDate(TODAY)).rejects.toThrow(
        'db connection lost',
      );
      expect(repo.upsertSnapshots).not.toHaveBeenCalled();
    });
  });

  describe('generateForYesterday', () => {
    it('calls generateForDate with yesterday UTC', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAggregation()]);
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
      repo.aggregateForDate.mockResolvedValue([makeAggregation()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const from = new Date('2024-06-01T00:00:00.000Z');
      const to = new Date('2024-06-03T00:00:00.000Z');

      const results = await generator.backfill(from, to);

      expect(results).toHaveLength(3);
      expect(repo.aggregateForDate).toHaveBeenCalledTimes(3);

      const dates = results.map((r) => r.date.toISOString().split('T')[0]);
      expect(dates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
    });

    it('returns single result when from === to', async () => {
      repo.aggregateForDate.mockResolvedValue([makeAggregation()]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const results = await generator.backfill(TODAY, TODAY);

      expect(results).toHaveLength(1);
    });

    it('returns empty array when from > to', async () => {
      const results = await generator.backfill(TODAY, YESTERDAY);
      expect(results).toHaveLength(0);
      expect(repo.aggregateForDate).not.toHaveBeenCalled();
    });

    it('accumulates results from each day', async () => {
      repo.aggregateForDate
        .mockResolvedValueOnce([makeAggregation()])
        .mockResolvedValueOnce([]);
      repo.upsertSnapshots.mockResolvedValue(1);

      const from = new Date('2024-06-01T00:00:00.000Z');
      const to = new Date('2024-06-02T00:00:00.000Z');

      const results = await generator.backfill(from, to);

      expect(results[0].assetRowsWritten).toBe(1);
      expect(results[1].assetRowsWritten).toBe(0); // no data day
    });
  });

  describe('aggregation metric correctness', () => {
    it('passes null volume fields through when volume is unavailable', async () => {
      const noVolume = makeAggregation({
        totalVolume: null,
        volumeWeightedSentiment: null,
      });
      repo.aggregateForDate.mockResolvedValue([noVolume]);
      repo.upsertSnapshots.mockResolvedValue(1);

      await generator.generateForDate(TODAY);

      const upsertArg: AssetAggregation[] =
        repo.upsertSnapshots.mock.calls[0][1];
      expect(upsertArg[0].totalVolume).toBeNull();
      expect(upsertArg[0].volumeWeightedSentiment).toBeNull();
    });

    it('passes volume-weighted sentiment when volume is present', async () => {
      const withVolume = makeAggregation({
        totalVolume: 500_000,
        volumeWeightedSentiment: 0.72,
      });
      repo.aggregateForDate.mockResolvedValue([withVolume]);
      repo.upsertSnapshots.mockResolvedValue(1);

      await generator.generateForDate(TODAY);

      const upsertArg: AssetAggregation[] =
        repo.upsertSnapshots.mock.calls[0][1];
      expect(upsertArg[0].volumeWeightedSentiment).toBe(0.72);
    });

    it('correctly counts asset vs global rows', async () => {
      const aggs = [
        makeAggregation({ assetSymbol: 'BTC' }),
        makeAggregation({ assetSymbol: 'ETH' }),
        makeAggregation({ assetSymbol: 'SOL' }),
        globalAggregation(),
      ];
      repo.aggregateForDate.mockResolvedValue(aggs);
      repo.upsertSnapshots.mockResolvedValue(4);

      const result = await generator.generateForDate(TODAY);

      expect(result.assetRowsWritten).toBe(3);
      expect(result.globalRowWritten).toBe(true);
    });
  });
});
