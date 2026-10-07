import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PaginationQueryDto,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createOffsetMeta,
  createCursorMeta,
  paginateArray,
} from './index';

describe('PaginationQueryDto', () => {
  const toInstance = (query: Record<string, unknown>) =>
    plainToInstance(PaginationQueryDto, query);

  it('applies the default page and page size when no parameters are provided', async () => {
    const query = toInstance({});

    expect(query.page).toBe(1);
    expect(query.limit).toBe(DEFAULT_PAGE_SIZE);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('coerces string query parameters to numbers', async () => {
    const query = toInstance({ page: '3', limit: '50' });

    expect(query.page).toBe(3);
    expect(query.limit).toBe(50);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects a limit above the server-side maximum', async () => {
    const errors = await validate(toInstance({ limit: MAX_PAGE_SIZE + 1 }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('rejects a limit below 1', async () => {
    const errors = await validate(toInstance({ limit: 0 }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('rejects a page below 1', async () => {
    const errors = await validate(toInstance({ page: 0 }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('rejects a non-numeric limit', async () => {
    const errors = await validate(toInstance({ limit: 'not-a-number' }));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isInt');
  });

  it('accepts the maximum page size', async () => {
    await expect(
      validate(toInstance({ limit: MAX_PAGE_SIZE })),
    ).resolves.toHaveLength(0);
  });
});

describe('pagination metadata', () => {
  it('builds offset metadata with a populated total and no cursor', () => {
    const meta = createOffsetMeta({ page: 2, limit: 20, total: 150 });

    expect(meta).toEqual({
      limit: 20,
      page: 2,
      total: 150,
      totalPages: 8,
      nextCursor: null,
    });
  });

  it('returns null totalPages when the total is unknown', () => {
    const meta = createOffsetMeta({ page: 1, limit: 20, total: null });

    expect(meta.total).toBeNull();
    expect(meta.totalPages).toBeNull();
  });

  it('builds cursor metadata with a populated cursor and no page info', () => {
    const meta = createCursorMeta({ limit: 50, nextCursor: 'abc123' });

    expect(meta).toEqual({
      limit: 50,
      page: null,
      total: null,
      totalPages: null,
      nextCursor: 'abc123',
    });
  });

  it('produces an identical key set for offset and cursor metadata', () => {
    const offsetKeys = Object.keys(
      createOffsetMeta({ page: 1, limit: 20, total: 10 }),
    ).sort();
    const cursorKeys = Object.keys(
      createCursorMeta({ limit: 20, nextCursor: 'x' }),
    ).sort();

    expect(offsetKeys).toEqual(cursorKeys);
    expect(offsetKeys).toEqual([
      'limit',
      'nextCursor',
      'page',
      'total',
      'totalPages',
    ]);
  });

  it('nulls the cursor when a cursor endpoint has no further pages', () => {
    expect(createCursorMeta({ limit: 20 }).nextCursor).toBeNull();
  });
});

describe('paginateArray', () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);

  it('returns the requested page and the total number of items', () => {
    const page2 = paginateArray(items, 2, 20);

    expect(page2.items).toEqual(items.slice(20, 40));
    expect(page2.total).toBe(45);
  });

  it('returns a partial final page', () => {
    const lastPage = paginateArray(items, 3, 20);

    expect(lastPage.items).toEqual(items.slice(40, 45));
    expect(lastPage.total).toBe(45);
  });

  it('returns an empty page past the end instead of throwing', () => {
    const beyond = paginateArray(items, 99, 20);

    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(45);
  });
});
