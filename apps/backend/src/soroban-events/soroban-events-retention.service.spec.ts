import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SorobanEventsRetentionService } from './soroban-events-retention.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeJobLock(acquired = true): jest.Mocked<JobLockService> {
  return {
    withLock: jest.fn(async (_name: string, fn: () => Promise<unknown>) => {
      if (!acquired) return null;
      return fn();
    }),
    tryAcquire: jest.fn().mockResolvedValue(acquired),
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<JobLockService>;
}

function makeJobHistory(): jest.Mocked<JobHistoryService> {
  return {
    start: jest.fn().mockResolvedValue({ id: 'run-1' }),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<JobHistoryService>;
}

function makeDataSource(rowsMoved = 5): jest.Mocked<DataSource> {
  return {
    query: jest.fn().mockResolvedValue([{ count: String(rowsMoved) }]),
  } as unknown as jest.Mocked<DataSource>;
}

function makeConfig(
  hotWindowDays: number | undefined = 90,
): jest.Mocked<ConfigService> {
  return {
    get: jest.fn((key: string, defaultVal?: unknown) => {
      if (key === 'SOROBAN_HOT_WINDOW_DAYS') return hotWindowDays ?? defaultVal;
      return defaultVal;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SorobanEventsRetentionService', () => {
  let service: SorobanEventsRetentionService;
  let jobLock: jest.Mocked<JobLockService>;
  let jobHistory: jest.Mocked<JobHistoryService>;
  let dataSource: jest.Mocked<DataSource>;

  async function build(
    hotWindowDays?: number,
    rowsMoved?: number,
    acquired = true,
  ) {
    jobLock = makeJobLock(acquired);
    jobHistory = makeJobHistory();
    dataSource = makeDataSource(rowsMoved);
    const config = makeConfig(hotWindowDays);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventsRetentionService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: JobLockService, useValue: jobLock },
        { provide: JobHistoryService, useValue: jobHistory },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(SorobanEventsRetentionService);
  }

  // ── happy path ──────────────────────────────────────────────────────────────

  it('moves rows when hot window > 0 and lock is acquired', async () => {
    await build(90, 42);

    const result = await service.runRetention();

    expect(result).toEqual({ archived: 42 });
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(jobHistory.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archived: 42, hotWindowDays: 90 }),
    );
  });

  it('returns archived=0 and skips DB when hot window is 0', async () => {
    await build(0);

    const result = await service.runRetention();

    expect(result).toEqual({ archived: 0 });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(jobHistory.complete).not.toHaveBeenCalled();
  });

  it('returns archived=0 when lock is not acquired', async () => {
    await build(90, 10, false /* lock not acquired */);

    const result = await service.runRetention();

    expect(result).toEqual({ archived: 0 });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('passes the cutoff date based on SOROBAN_HOT_WINDOW_DAYS', async () => {
    const hotWindowDays = 30;
    await build(hotWindowDays, 1);

    const before = Date.now();
    await service.runRetention();
    const after = Date.now();

    const callArgs = (dataSource.query as jest.Mock).mock.calls[0];
    const cutoff: Date = callArgs[1][0]; // $1 in the query

    // cutoff should be ~hotWindowDays ago
    const expectedLow = new Date(before - hotWindowDays * 24 * 60 * 60 * 1000);
    const expectedHigh = new Date(after - hotWindowDays * 24 * 60 * 60 * 1000);

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime() - 100);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHigh.getTime() + 100);
  });

  // ── error path ──────────────────────────────────────────────────────────────

  it('records failure in job history and returns archived=0 on DB error', async () => {
    await build(90);
    const error = new Error('DB connection lost');
    (dataSource.query as jest.Mock).mockRejectedValueOnce(error);

    const result = await service.runRetention();

    expect(result).toEqual({ archived: 0 });
    expect(jobHistory.fail).toHaveBeenCalledWith(expect.anything(), error);
  });

  // ── idempotency ─────────────────────────────────────────────────────────────

  it('passes MAX_ROWS_PER_RUN as the limit parameter', async () => {
    await build(90, 50_000);

    await service.runRetention();

    const callArgs = (dataSource.query as jest.Mock).mock.calls[0];
    const limit: number = callArgs[1][1]; // $2 in the query

    expect(limit).toBe(50_000);
  });
});
