import {
  buildPaginationMeta,
  isPaginatedResult,
  resolveRequestId,
  wantsEnvelope,
} from './envelope.utils';

describe('envelope utils', () => {
  it('detects the opt-in header, including array values', () => {
    expect(wantsEnvelope({ headers: { 'x-response-envelope': 'v1' } })).toBe(
      true,
    );
    expect(
      wantsEnvelope({
        headers: { 'x-response-envelope': ['v1', 'v2'] } as never,
      }),
    ).toBe(true);
    expect(wantsEnvelope({ headers: {} })).toBe(false);
    expect(wantsEnvelope({ headers: { 'x-response-envelope': '' } })).toBe(
      false,
    );
  });

  it('resolves the request id from correlationId, then requestId', () => {
    expect(resolveRequestId({ headers: {}, correlationId: 'c' })).toBe('c');
    expect(resolveRequestId({ headers: {}, requestId: 'r' })).toBe('r');
    expect(resolveRequestId({ headers: {} })).toBe('unknown');
  });

  it('recognises only complete paginated results', () => {
    expect(isPaginatedResult({ items: [], total: 0, page: 1, limit: 10 })).toBe(
      true,
    );
    expect(isPaginatedResult({ items: [], total: 0 })).toBe(false);
    expect(isPaginatedResult([1, 2])).toBe(false);
    expect(isPaginatedResult(null)).toBe(false);
  });

  it('clamps invalid pagination numbers', () => {
    expect(
      buildPaginationMeta(
        { items: [], total: -5, page: 0, limit: 0 },
        'r',
        't',
      ),
    ).toEqual({
      requestId: 'r',
      timestamp: 't',
      page: 1,
      limit: 1,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    });
  });
});
