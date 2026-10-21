import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';
import {
  compareOutboxWithIndex,
  IndexedChainEvent,
  OUTBOX_INDEX_DATASET,
  OutboxChainRef,
  OutboxIndexConsistencyService,
} from './outbox-index-consistency.service';

const mockCheckConfig = {
  windowMinutes: 120,
  settleMinutes: 15,
  maxRows: 2,
  requiredTypes: [] as string[],
};

jest.mock('../lib/config', () => ({
  config: {
    get outboxIndexCheck() {
      return mockCheckConfig;
    },
  },
}));

const ref = (over: Partial<OutboxChainRef>): OutboxChainRef => ({
  outboxEventId: 'ob-1',
  outboxEventType: 'contribution.recorded',
  outboxStatus: 'processed',
  createdAt: '2026-10-19T10:00:00.000Z',
  txHash: 'tx-a',
  eventIndex: 0,
  ...over,
});

const indexed = (over: Partial<IndexedChainEvent>): IndexedChainEvent => ({
  sorobanEventId: 'se-1',
  txHash: 'tx-a',
  eventIndex: 0,
  canonicalType: 'contribution',
  eventType: 'deposit',
  ledgerSequence: '100',
  ...over,
});

describe('compareOutboxWithIndex', () => {
  it('reports nothing when every published event is indexed', () => {
    expect(compareOutboxWithIndex([ref({})], [indexed({})], [])).toEqual([]);
  });

  it('reports a published event missing from the index, by exact position', () => {
    const result = compareOutboxWithIndex(
      [ref({ eventIndex: 1 })],
      [indexed({ eventIndex: 0 })],
      [],
    );
    expect(result).toEqual([
      {
        kind: 'published_not_indexed',
        txHash: 'tx-a',
        eventIndex: 1,
        outboxEventIds: ['ob-1'],
        outboxEventType: 'contribution.recorded',
      },
    ]);
  });

  it('matches a transaction-level reference against any indexed event of that tx', () => {
    expect(
      compareOutboxWithIndex(
        [ref({ eventIndex: null })],
        [indexed({ eventIndex: 3 })],
        [],
      ),
    ).toEqual([]);
    expect(
      compareOutboxWithIndex([ref({ eventIndex: null })], [], [])[0].kind,
    ).toBe('published_not_indexed');
  });

  it('reports the same chain event published twice', () => {
    const result = compareOutboxWithIndex(
      [ref({ outboxEventId: 'ob-1' }), ref({ outboxEventId: 'ob-2' })],
      [indexed({})],
      [],
    );
    expect(result).toEqual([
      expect.objectContaining({
        kind: 'duplicate_publish',
        txHash: 'tx-a',
        eventIndex: 0,
        outboxEventIds: ['ob-1', 'ob-2'],
      }),
    ]);
  });

  it('does not treat different event types on one chain event as duplicates', () => {
    expect(
      compareOutboxWithIndex(
        [
          ref({ outboxEventId: 'ob-1' }),
          ref({ outboxEventId: 'ob-2', outboxEventType: 'other' }),
        ],
        [indexed({})],
        [],
      ),
    ).toEqual([]);
  });

  it('reports a required indexed event that was never published', () => {
    const required = indexed({
      sorobanEventId: 'se-9',
      txHash: 'tx-b',
      eventIndex: 2,
    });
    expect(compareOutboxWithIndex([], [], [required])).toEqual([
      {
        kind: 'indexed_not_published',
        txHash: 'tx-b',
        eventIndex: 2,
        outboxEventIds: [],
        sorobanEventId: 'se-9',
        canonicalType: 'contribution',
        ledgerSequence: '100',
      },
    ]);
    expect(
      compareOutboxWithIndex(
        [ref({ txHash: 'tx-b', eventIndex: 2 })],
        [],
        [required],
      ),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'indexed_not_published' }),
    );
  });
});

describe('OutboxIndexConsistencyService.runCheck', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');
  let query: jest.Mock;
  let metrics: { recordReconciliationDrift: jest.Mock };
  let service: OutboxIndexConsistencyService;
  const setConfig = (over: Partial<typeof mockCheckConfig>) =>
    Object.assign(mockCheckConfig, over);

  beforeEach(() => {
    query = jest.fn();
    metrics = { recordReconciliationDrift: jest.fn() };
    service = new OutboxIndexConsistencyService(
      { query } as unknown as DataSource,
      metrics as unknown as MetricsService,
    );
    setConfig({
      windowMinutes: 120,
      settleMinutes: 15,
      maxRows: 2,
      requiredTypes: [],
    });
  });

  const routeQuery = (respond: (sql: string, params: unknown[]) => unknown) =>
    query.mockImplementation((sql: string, params: unknown[]) =>
      Promise.resolve(respond(sql, params)),
    );

  const outboxRow = (
    id: string,
    txHash: string,
    eventIndex: string | null,
  ) => ({
    id,
    eventType: 'contribution.recorded',
    status: 'processed',
    createdAt: now,
    txHash,
    eventIndex,
  });

  it('windows the scan, bounds it, and alerts on missing index rows', async () => {
    routeQuery((sql: string) => {
      if (sql.includes('FROM "outbox_events"')) {
        return [outboxRow('ob-1', 'tx-a', '0'), outboxRow('ob-2', 'tx-b', '0')];
      }
      return [
        {
          id: 'se-1',
          txHash: 'tx-a',
          eventIndex: 0,
          canonicalType: null,
          eventType: null,
          ledgerSequence: 5,
        },
      ];
    });

    const result = await service.runCheck(now);

    const [, params] = query.mock.calls[0];
    expect(params[0]).toEqual(new Date('2026-10-19T09:45:00.000Z'));
    expect(params[1]).toEqual(new Date('2026-10-19T11:45:00.000Z'));
    expect(params[2]).toBe(3); // maxRows + 1 detects truncation
    expect(result.truncated).toBe(false);
    expect(result.counts).toEqual({
      published_not_indexed: 1,
      indexed_not_published: 0,
      duplicate_publish: 0,
    });
    expect(result.discrepancies[0]).toMatchObject({
      txHash: 'tx-b',
      outboxEventIds: ['ob-2'],
    });
    expect(metrics.recordReconciliationDrift).toHaveBeenCalledWith(
      OUTBOX_INDEX_DATASET,
      'critical',
      1,
    );
  });

  it('flags truncation with a warning alert', async () => {
    routeQuery((sql: string) =>
      sql.includes('FROM "outbox_events"')
        ? [
            outboxRow('ob-1', 'tx-a', '0'),
            outboxRow('ob-2', 'tx-a', '1'),
            outboxRow('ob-3', 'tx-a', '2'),
          ]
        : [0, 1].map((i) => ({
            id: `se-${i}`,
            txHash: 'tx-a',
            eventIndex: i,
            canonicalType: null,
            eventType: null,
            ledgerSequence: null,
          })),
    );

    const result = await service.runCheck(now);

    expect(result.truncated).toBe(true);
    expect(result.outboxEventsChecked).toBe(2);
    expect(result.discrepancies).toEqual([]);
    expect(metrics.recordReconciliationDrift).toHaveBeenCalledWith(
      OUTBOX_INDEX_DATASET,
      'warning',
      2,
    );
  });

  it('checks required types against outbox events from outside the window', async () => {
    setConfig({
      windowMinutes: 120,
      settleMinutes: 15,
      maxRows: 10,
      requiredTypes: ['contribution'],
    });
    routeQuery((sql: string, params: unknown[]) => {
      if (sql.includes('"createdAt" >= $1')) return [];
      if (sql.includes('"canonicalType" = ANY($1)')) {
        return ['tx-old', 'tx-none'].map((txHash, i) => ({
          id: `se-${i}`,
          txHash,
          eventIndex: 0,
          canonicalType: 'contribution',
          eventType: 'deposit',
          ledgerSequence: '7',
        }));
      }
      if (sql.includes('"payload"->>\'txHash\' = ANY($1)')) {
        expect(params[0]).toEqual(['tx-old', 'tx-none']);
        return [outboxRow('ob-old', 'tx-old', '0')];
      }
      return [
        {
          id: 'se-0',
          txHash: 'tx-old',
          eventIndex: 0,
          canonicalType: 'contribution',
          eventType: 'deposit',
          ledgerSequence: '7',
        },
      ];
    });

    const result = await service.runCheck(now);

    expect(result.counts.indexed_not_published).toBe(1);
    expect(result.discrepancies).toEqual([
      expect.objectContaining({
        kind: 'indexed_not_published',
        txHash: 'tx-none',
        sorobanEventId: 'se-1',
      }),
    ]);
  });

  it('raises no alert when the pipelines agree', async () => {
    query.mockResolvedValue([]);
    const result = await service.runCheck(now);
    expect(result.discrepancies).toEqual([]);
    expect(metrics.recordReconciliationDrift).not.toHaveBeenCalled();
  });
});
