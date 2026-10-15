import { apiClient } from '../api-client';
import { NOT_FOUND_ROUTE, resolveDeepLink } from '../deep-links';
import {
  SIGNAL_STALE_AFTER_MS,
  SignalCategory,
  SignalSeverity,
  UserSignal,
  extractAssetCode,
  fetchSignals,
  formatSignalAge,
  isSignalCategory,
  isSignalSeverity,
  isSignalStale,
  normalizeSignals,
  signalDeepLink,
  signalKey,
  signalSubject,
  signalSubjectLabel,
  sortSignalsByStrength,
  toSignalsFeed,
} from '../signals';

jest.mock('../api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const mockedGet = apiClient.get as unknown as jest.Mock;

function signal(overrides: Partial<UserSignal> = {}): UserSignal {
  return {
    category: 'risk',
    severity: 'medium',
    title: 'Single-asset concentration',
    detail: 'The portfolio holds only XLM, which may increase exposure to a single asset.',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signal enum guards', () => {
  it('accepts only the categories the backend defines', () => {
    const valid: SignalCategory[] = ['holdings', 'activity', 'risk', 'fallback'];
    for (const category of valid) expect(isSignalCategory(category)).toBe(true);

    for (const value of ['unknown', 'RISK', '', 42, null, undefined]) {
      expect(isSignalCategory(value)).toBe(false);
    }
  });

  it('accepts only the severities the backend defines', () => {
    const valid: SignalSeverity[] = ['low', 'medium', 'high'];
    for (const severity of valid) expect(isSignalSeverity(severity)).toBe(true);

    for (const value of ['critical', 'HIGH', '', 3, {}, undefined]) {
      expect(isSignalSeverity(value)).toBe(false);
    }
  });
});

describe('normalizeSignals', () => {
  it('drops entries that cannot be rendered instead of throwing', () => {
    const normalized = normalizeSignals([
      signal(),
      null,
      'str',
      [],
      { category: 'risk', severity: 'high', title: 'No detail' },
      { category: 'risk', severity: 'high', detail: 'No title' },
      { category: 'risk', severity: '   ', title: 't', detail: 'd' },
      { category: 'nope', severity: 'high', title: 't', detail: 'd' },
      { severity: 'high', title: 't', detail: 'd' },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].title).toBe('Single-asset concentration');
  });

  it('returns an empty list for a non-array payload', () => {
    expect(normalizeSignals(undefined)).toEqual([]);
    expect(normalizeSignals({ signals: [] })).toEqual([]);
  });

  it('keeps an explicit assetCode and ignores a blank one', () => {
    expect(normalizeSignals([signal({ assetCode: 'USDC' })])[0].assetCode).toBe('USDC');
    expect(normalizeSignals([signal({ assetCode: '   ' })])[0]).not.toHaveProperty('assetCode');
  });
});

describe('toSignalsFeed', () => {
  it('normalizes a full payload', () => {
    const feed = toSignalsFeed({
      userId: 'user-1',
      generatedAt: '2026-09-28T10:00:00.000Z',
      signals: [signal()],
    });

    expect(feed.userId).toBe('user-1');
    expect(feed.generatedAt).toBe('2026-09-28T10:00:00.000Z');
    expect(feed.signals).toHaveLength(1);
  });

  it('tolerates a missing or malformed payload', () => {
    expect(toSignalsFeed(null)).toEqual({ userId: '', generatedAt: null, signals: [] });
    expect(toSignalsFeed({ generatedAt: 12345, signals: 'nope' })).toEqual({
      userId: '',
      generatedAt: null,
      signals: [],
    });
  });
});

describe('fetchSignals', () => {
  it('reads /signals/latest and normalizes the response', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: { userId: 'user-1', generatedAt: '2026-09-28T10:00:00.000Z', signals: [signal()] },
    });

    const result = await fetchSignals();

    expect(mockedGet).toHaveBeenCalledWith('/signals/latest');
    expect(result.success).toBe(true);
    expect(result.data?.signals).toHaveLength(1);
  });

  it('propagates transport failures without throwing', async () => {
    mockedGet.mockResolvedValue({
      success: false,
      error: { message: 'No internet connection', error: 'NetworkError' },
    });

    const result = await fetchSignals();

    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('NetworkError');
    expect(result.data).toBeUndefined();
  });
});

describe('signal subject', () => {
  it('reads the asset named by the single-asset concentration copy', () => {
    expect(extractAssetCode(signal())).toBe('XLM');
  });

  it('reads the asset named by the concentration copy', () => {
    const concentrated = signal({
      title: 'Concentrated holdings',
      detail: 'More than 78% of portfolio value is held in AQUA.',
    });
    expect(extractAssetCode(concentrated)).toBe('AQUA');
  });

  it('normalizes an explicitly provided asset code', () => {
    expect(extractAssetCode(signal({ assetCode: ' usdc ' }))).toBe('USDC');
  });

  it('does not misread ordinary words as tickers', () => {
    const noAsset = signal({
      title: 'Stablecoin exposure',
      detail: 'Stablecoins represent 42% of the portfolio, which may reduce volatility.',
    });
    expect(extractAssetCode(noAsset)).toBeNull();
    expect(signalSubject(noAsset)).toEqual({ kind: 'portfolio' });
  });

  it('classifies activity and fallback signals when no asset is named', () => {
    expect(signalSubject(signal({ category: 'activity', title: 'No recent activity', detail: 'x' }))).toEqual({
      kind: 'activity',
    });
    expect(
      signalSubject(signal({ category: 'fallback', title: 'No holdings', detail: 'Connect an account.' })),
    ).toEqual({ kind: 'none' });
  });

  it('labels the subject for display', () => {
    expect(signalSubjectLabel(signal())).toBe('XLM');
    expect(
      signalSubjectLabel(signal({ title: 'Diversified holdings', detail: 'The portfolio contains 5 distinct assets.' })),
    ).toBe('Portfolio');
    expect(signalSubjectLabel(signal({ category: 'activity', title: 'No recent activity', detail: 'x' }))).toBe(
      'Activity',
    );
    expect(signalSubjectLabel(signal({ category: 'fallback', title: 'x', detail: 'y' }))).toBe('General');
  });
});

describe('signalDeepLink', () => {
  it('opens the discover tab with the asset preselected for asset signals', () => {
    expect(signalDeepLink(signal())).toBe('mobile://discover?asset=XLM');
  });

  it('routes non-asset signals to the notification inbox', () => {
    expect(
      signalDeepLink(signal({ category: 'activity', title: 'No recent activity', detail: 'Nothing yet.' })),
    ).toBe('mobile://notifications');
  });

  it('resolves every signal link to a real screen through the route table', () => {
    const cases: UserSignal[] = [
      signal(), // asset subject -> discover
      signal({ category: 'risk', severity: 'high', title: 'Diversify', detail: 'No asset named.' }),
      signal({ category: 'activity', title: 'No recent activity', detail: 'Nothing yet.' }),
      signal({ category: 'fallback', title: 'Notice', detail: 'Nothing to report.' }),
    ];

    for (const entry of cases) {
      const resolved = resolveDeepLink(signalDeepLink(entry));
      expect(resolved.routeKey).not.toBeNull();
      expect(resolved.route).not.toBe(NOT_FOUND_ROUTE);
    }
  });

  it('keeps the asset a signal names in the resolved discover target', () => {
    const resolved = resolveDeepLink(signalDeepLink(signal()));
    expect(resolved).toMatchObject({
      routeKey: 'discover',
      authRequired: false,
      params: { asset: 'XLM' },
    });
    expect(resolved.route).toContain('asset=XLM');
  });
});

describe('signal age', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z');

  it('formats each age bucket', () => {
    expect(formatSignalAge('2026-09-28T11:59:30.000Z', now)).toBe('just now');
    expect(formatSignalAge('2026-09-28T11:25:00.000Z', now)).toBe('35m ago');
    expect(formatSignalAge('2026-09-28T08:00:00.000Z', now)).toBe('4h ago');
    expect(formatSignalAge('2026-09-25T12:00:00.000Z', now)).toBe('3d ago');
    expect(formatSignalAge('2026-09-07T12:00:00.000Z', now)).toBe('3w ago');
  });

  it('reports an unknown age rather than a nonsense one', () => {
    expect(formatSignalAge(null, now)).toBe('age unknown');
    expect(formatSignalAge('not a date', now)).toBe('age unknown');
  });

  it('labels stale feeds and treats an unknown age as stale', () => {
    expect(isSignalStale('2026-09-28T11:30:00.000Z', now)).toBe(false);
    expect(isSignalStale('2026-09-28T09:00:00.000Z', now)).toBe(true);
    expect(isSignalStale('2026-09-28T11:30:00.000Z', now, 60 * 1000)).toBe(true);
    expect(isSignalStale(null, now)).toBe(true);
    expect(isSignalStale('garbage', now)).toBe(true);
  });

  it('exposes the default staleness threshold', () => {
    expect(SIGNAL_STALE_AFTER_MS).toBe(60 * 60 * 1000);
  });
});

describe('sortSignalsByStrength', () => {
  it('puts the strongest signal first and keeps backend order within a severity', () => {
    const sorted = sortSignalsByStrength([
      signal({ severity: 'low', title: 'a' }),
      signal({ severity: 'high', title: 'b' }),
      signal({ severity: 'low', title: 'c' }),
      signal({ severity: 'medium', title: 'd' }),
    ]);

    expect(sorted.map((s) => s.title)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not mutate the input list', () => {
    const input = [signal({ severity: 'low' }), signal({ severity: 'high' })];
    sortSignalsByStrength(input);
    expect(input[0].severity).toBe('low');
  });
});

describe('signalKey', () => {
  it('is stable for the same signal at the same index', () => {
    const s = signal();
    expect(signalKey(s, 0)).toBe(signalKey(s, 0));
    expect(signalKey(s, 0)).not.toBe(signalKey(s, 1));
  });
});
