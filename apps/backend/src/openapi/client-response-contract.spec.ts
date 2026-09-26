// Client-facing response contract test (Issue #1435). Mirrors the mobile
// WatchlistItem contract, ahead of deriving the full consumer set from
// apps/webapp and apps/mobile automatically.
interface WatchlistItemResponse {
  id: string;
  symbol: string;
  name: string | null;
  sortOrder: number;
}

function matchesWatchlistItemContract(value: unknown): value is WatchlistItemResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.symbol === 'string' &&
    (typeof v.name === 'string' || v.name === null) &&
    typeof v.sortOrder === 'number'
  );
}

describe('watchlist item client response contract', () => {
  const consumerExpectedShape = {
    id: 'w1',
    symbol: 'XLM',
    name: 'Stellar Lumens',
    sortOrder: 0,
  };

  it('matches what mobile/webapp clients expect for a watchlist item', () => {
    expect(matchesWatchlistItemContract(consumerExpectedShape)).toBe(true);
  });

  it('flags a breaking change: a field renamed out from under clients', () => {
    const renamed: Record<string, unknown> = { ...consumerExpectedShape };
    renamed.order = renamed.sortOrder;
    delete renamed.sortOrder;
    expect(matchesWatchlistItemContract(renamed)).toBe(false);
  });
});
