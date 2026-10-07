import { getMockTransactions, mockTransactions } from './mock-transactions';
import {
  TransactionDto,
  TransactionType,
  TransactionStatus,
} from '../dto/transaction.dto';

/**
 * Cursor stability against concurrent inserts.
 *
 * The transaction list endpoints are cursor-paginated: a client fetches a
 * page, then resumes the walk by passing the returned cursor. These tests
 * verify the guarantee documented in docs/pagination.md — a record inserted
 * between two page fetches must never cause already-seen records to be
 * duplicated or not-yet-seen records to be skipped.
 */
describe('transaction cursor pagination stability', () => {
  /** Newest-first copy of the dataset, as Horizon would order it. */
  const sortedDataset = (): TransactionDto[] =>
    [...mockTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

  /** Builds a transaction that sorts before every existing record. */
  const makeNewerTransaction = (id: string): TransactionDto => ({
    id,
    type: TransactionType.PAYMENT,
    amount: '10.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GCONCURRENTINSERTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    to: 'GDESTINATION1234567890DESTINATION1234567890',
    date: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour in the future
    status: TransactionStatus.SUCCESS,
    transactionHash: `hash-${id}`,
    memo: 'Concurrent insert',
    fee: '100',
    description: 'Sent 10.00 XLM to GDES...5678',
  });

  it('walks the whole dataset with disjoint pages and no skipped records', () => {
    const source = sortedDataset();
    const seenIds: string[] = [];
    let cursor: string | undefined;
    let guard = 0;

    do {
      const page = getMockTransactions(4, cursor, source);
      seenIds.push(...page.transactions.map((t) => t.id));
      cursor = page.nextPage;
      guard += 1;
    } while (cursor && guard < 50);

    expect(new Set(seenIds).size).toBe(seenIds.length); // no duplicates
    expect(seenIds).toEqual(source.map((t) => t.id)); // nothing skipped
  });

  it('does not duplicate or skip records when one is inserted mid-walk', () => {
    const source = sortedDataset();
    const originalIds = source.map((t) => t.id);

    // Page 1 of the walk.
    const pageOne = getMockTransactions(4, undefined, source);
    expect(pageOne.nextPage).toBeDefined();
    const seenIds = pageOne.transactions.map((t) => t.id);

    // A new transaction lands between the two page fetches.
    const inserted = makeNewerTransaction('999-concurrent');
    source.unshift(inserted);

    // Resume the walk from the cursor returned by page 1.
    let cursor: string | undefined = pageOne.nextPage;
    let guard = 0;
    while (cursor && guard < 50) {
      const page = getMockTransactions(4, cursor, source);
      seenIds.push(...page.transactions.map((t) => t.id));
      cursor = page.nextPage;
      guard += 1;
    }

    // No record appears twice...
    expect(new Set(seenIds).size).toBe(seenIds.length);

    // ...and every record that existed when the walk started was visited
    // exactly once: the concurrent insert neither shifted pages (skipping
    // records) nor replayed them (duplicating records).
    expect([...seenIds].sort()).toEqual([...originalIds].sort());

    // The concurrently inserted record was not part of the resumed walk —
    // it is only visible from a fresh page-1 fetch.
    expect(seenIds).not.toContain(inserted.id);
    const freshPageOne = getMockTransactions(4, undefined, source);
    expect(freshPageOne.transactions[0].id).toBe(inserted.id);
  });

  it('reports no further page when the last page is consumed', () => {
    const source = sortedDataset();
    const lastPage = getMockTransactions(source.length, undefined, source);

    expect(lastPage.transactions).toHaveLength(source.length);
    expect(lastPage.nextPage).toBeUndefined();
  });
});
