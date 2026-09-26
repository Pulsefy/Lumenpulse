// Contract test for the WatchlistItem response shape (Issue #1415).
// Starts the pattern hand-derived, ahead of full OpenAPI-generated coverage.
interface WatchlistItemShape {
  id: string;
  symbol: string;
  name: string | null;
  sortOrder: number;
}

function isWatchlistItemShape(value: unknown): value is WatchlistItemShape {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.symbol === 'string' &&
    (typeof v.name === 'string' || v.name === null) &&
    typeof v.sortOrder === 'number'
  );
}

describe('WatchlistItem response contract', () => {
  const validItem = { id: 'w1', symbol: 'XLM', name: 'Stellar Lumens', sortOrder: 0 };

  it('accepts a well-formed watchlist item', () => {
    expect(isWatchlistItemShape(validItem)).toBe(true);
  });

  it('rejects a response missing a required field', () => {
    const partial: Record<string, unknown> = { ...validItem };
    delete partial.sortOrder;
    expect(isWatchlistItemShape(partial)).toBe(false);
  });

  it('rejects a response with a type-mismatched field', () => {
    expect(isWatchlistItemShape({ ...validItem, sortOrder: '0' })).toBe(false);
  });
});
