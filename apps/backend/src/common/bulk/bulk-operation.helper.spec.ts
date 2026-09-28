import { BadRequestException } from '@nestjs/common';
import { executeBulkOperation, MAX_BATCH_SIZE } from './bulk-operation.helper';

describe('executeBulkOperation', () => {
  it('returns success results for all items', async () => {
    const ids = ['a', 'b', 'c'];
    const result = await executeBulkOperation(ids, (id) =>
      Promise.resolve({ processed: id }),
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(3);
    result.results.forEach((r) => expect(r.success).toBe(true));
  });

  it('isolates per-item failures — other items still succeed', async () => {
    const ids = ['good1', 'bad', 'good2'];
    const result = await executeBulkOperation(ids, (id) => {
      if (id === 'bad') return Promise.reject(new Error('item error'));
      return Promise.resolve({ id });
    });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const failedItem = result.results.find((r) => r.id === 'bad')!;
    expect(failedItem.success).toBe(false);
    expect(failedItem.error).toBe('item error');

    const goodItems = result.results.filter((r) => r.id !== 'bad');
    goodItems.forEach((r) => expect(r.success).toBe(true));
  });

  it('assigns a consistent bulkOperationId to every operation call', async () => {
    const ids = ['x', 'y'];
    const capturedIds: string[] = [];

    await executeBulkOperation(ids, (_id, bulkOperationId) => {
      capturedIds.push(bulkOperationId);
      return Promise.resolve(null);
    });

    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).toBe(capturedIds[1]);
    // Should be a valid UUID v4
    expect(capturedIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('throws BadRequestException for empty array', async () => {
    await expect(
      executeBulkOperation([], () => Promise.resolve(null)),
    ).rejects.toThrow(BadRequestException);
  });

  it(`throws BadRequestException when batch exceeds MAX_BATCH_SIZE (${MAX_BATCH_SIZE})`, async () => {
    const ids = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => String(i));
    await expect(
      executeBulkOperation(ids, () => Promise.resolve(null)),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a batch of exactly MAX_BATCH_SIZE items', async () => {
    const ids = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => String(i));
    const result = await executeBulkOperation(ids, (id) => Promise.resolve(id));
    expect(result.total).toBe(MAX_BATCH_SIZE);
    expect(result.succeeded).toBe(MAX_BATCH_SIZE);
  });

  it('preserves original ordering of results', async () => {
    const ids = ['first', 'second', 'third'];
    const result = await executeBulkOperation(ids, (id) => Promise.resolve(id));
    expect(result.results.map((r) => r.id)).toEqual(ids);
  });

  it('captures non-Error throws as string messages', async () => {
    const ids = ['x'];
    const result = await executeBulkOperation(ids, () =>
      Promise.reject('string error'),
    );

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBe('Unknown error occurred');
  });
});
