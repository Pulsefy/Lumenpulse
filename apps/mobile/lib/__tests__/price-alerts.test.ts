import type { PendingMutation } from '../mutation-queue';
import {
  DEFAULT_COOLDOWN_MINUTES,
  PENDING_RULE_PREFIX,
  PRICE_ALERT_MUTATIONS,
  PriceAlertDraft,
  PriceAlertQueue,
  PriceAlertRepository,
  PriceAlertRule,
  PriceAlertTransport,
  RawPriceAlertRule,
  TRIGGERED_BADGE_WINDOW_MS,
  alertStatus,
  alertStatusLabel,
  alertWillDeliver,
  deliveryEnabled,
  describePriceAlert,
  draftFromRule,
  emptyDraft,
  formatTargetPrice,
  isDraftValid,
  isPendingRule,
  normalizeSymbol,
  prefillDraftFromAsset,
  toCreateInput,
  toRule,
  toUpdateInput,
  validatePriceAlertDraft,
} from '../price-alerts';

// The shared singletons pull in AsyncStorage/NetInfo; the repository under test
// is always given an in-memory transport, queue and connectivity source, so the
// native-backed modules are replaced rather than loaded.
jest.mock('../api-client', () => ({ apiClient: {} }));
jest.mock('../cache', () => ({ cache: { isOnlineStatus: () => true } }));
jest.mock('../mutation-queue', () => ({ mutationQueue: { enqueue: jest.fn(), dequeue: jest.fn() } }));

/** In-memory transport so the repository can be driven deterministically. */
function fakeTransport() {
  const calls = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return { calls, transport: calls as unknown as PriceAlertTransport };
}

/** FIFO queue backed by an array, mirroring `mutationQueue` semantics. */
function fakeQueue() {
  const items: PendingMutation[] = [];
  let counter = 0;
  const queue: PriceAlertQueue = {
    enqueue: async (mutation) => {
      counter += 1;
      const queued: PendingMutation = {
        ...mutation,
        id: `m${counter}`,
        createdAt: new Date(0).toISOString(),
        state: 'pending',
        attempts: 0,
        lastError: null,
        updatedAt: new Date(0).toISOString(),
      };
      items.push(queued);
      return queued;
    },
    dequeue: async () => items.shift() ?? null,
  };
  return { queue, items };
}

function rawRule(overrides: Partial<RawPriceAlertRule> = {}): RawPriceAlertRule {
  return {
    id: 'rule-1',
    symbol: 'xlm',
    targetPrice: '0.15000000',
    condition: 'above',
    isActive: true,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<PriceAlertRule> = {}): PriceAlertRule {
  return { ...toRule(rawRule()), ...overrides };
}

function draft(overrides: Partial<PriceAlertDraft> = {}): PriceAlertDraft {
  return { ...emptyDraft('XLM'), targetPrice: '0.15', ...overrides };
}

/** Connectivity the tests flip to exercise the offline paths. */
let online = true;

function repository(transport: PriceAlertTransport, queue: PriceAlertQueue, extra = {}) {
  return new PriceAlertRepository({
    transport,
    queue,
    isOnline: () => online,
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  online = true;
});

describe('normalizeSymbol', () => {
  it('trims and upper-cases', () => {
    expect(normalizeSymbol('  xlm ')).toBe('XLM');
    expect(normalizeSymbol('usdc')).toBe('USDC');
  });
});

describe('validatePriceAlertDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validatePriceAlertDraft(draft())).toEqual({});
    expect(isDraftValid(draft())).toBe(true);
  });

  it('requires an asset', () => {
    expect(validatePriceAlertDraft(draft({ symbol: '' })).symbol).toBe('Choose an asset');
    expect(validatePriceAlertDraft(draft({ symbol: '   ' })).symbol).toBe('Choose an asset');
  });

  it('rejects symbols the backend would refuse', () => {
    expect(validatePriceAlertDraft(draft({ symbol: 'NOT A SYMBOL' })).symbol).toMatch(
      /1–12 letters or digits/,
    );
    expect(validatePriceAlertDraft(draft({ symbol: 'A'.repeat(13) })).symbol).toMatch(
      /1–12 letters or digits/,
    );
    // Lower-case input is normalized before the pattern is applied.
    expect(validatePriceAlertDraft(draft({ symbol: ' usdc ' }))).toEqual({});
  });

  it('requires a positive target price', () => {
    expect(validatePriceAlertDraft(draft({ targetPrice: '' })).targetPrice).toBe(
      'Enter a target price',
    );
    expect(validatePriceAlertDraft(draft({ targetPrice: 'abc' })).targetPrice).toBe(
      'Enter a price like 0.15',
    );
    expect(validatePriceAlertDraft(draft({ targetPrice: '0' })).targetPrice).toBe(
      'Price must be greater than zero',
    );
    expect(validatePriceAlertDraft(draft({ targetPrice: '-1' })).targetPrice).toBe(
      'Enter a price like 0.15',
    );
    expect(validatePriceAlertDraft(draft({ targetPrice: '.5' }))).toEqual({});
  });

  it('rejects more decimals than the decimal(20, 8) column holds', () => {
    expect(validatePriceAlertDraft(draft({ targetPrice: '0.123456789' })).targetPrice).toBe(
      'At most 8 decimal places',
    );
    expect(validatePriceAlertDraft(draft({ targetPrice: '0.12345678' }))).toEqual({});
  });

  it('bounds the cooldown the way @Min(1) does', () => {
    expect(validatePriceAlertDraft(draft({ cooldownMinutes: '' }))).toEqual({});
    expect(validatePriceAlertDraft(draft({ cooldownMinutes: '0' })).cooldownMinutes).toBe(
      'At least 1 minute',
    );
    expect(validatePriceAlertDraft(draft({ cooldownMinutes: '1.5' })).cooldownMinutes).toBe(
      'Whole minutes only',
    );
    expect(validatePriceAlertDraft(draft({ cooldownMinutes: '-5' })).cooldownMinutes).toBe(
      'Whole minutes only',
    );
    expect(validatePriceAlertDraft(draft({ cooldownMinutes: '1441' })).cooldownMinutes).toBe(
      'At most 1440 minutes',
    );
  });

  it('reports every invalid field at once', () => {
    const errors = validatePriceAlertDraft({
      symbol: '',
      targetPrice: '0',
      condition: 'below',
      cooldownMinutes: '0',
    });
    expect(Object.keys(errors).sort()).toEqual(['cooldownMinutes', 'symbol', 'targetPrice']);
  });
});

describe('draft conversion', () => {
  it('builds a create payload from a valid draft', () => {
    expect(toCreateInput(draft({ condition: 'below', cooldownMinutes: '120' }))).toEqual({
      symbol: 'XLM',
      targetPrice: 0.15,
      condition: 'below',
      cooldownMinutes: 120,
    });
  });

  it('omits an empty cooldown so the column default applies', () => {
    expect(toCreateInput(draft({ cooldownMinutes: '' }))).toEqual({
      symbol: 'XLM',
      targetPrice: 0.15,
      condition: 'above',
    });
  });

  it('refuses to build a payload from an invalid draft', () => {
    expect(toCreateInput(draft({ targetPrice: '0' }))).toBeNull();
    expect(toUpdateInput(draft({ symbol: '' }))).toBeNull();
  });

  it('builds an update payload without the symbol', () => {
    expect(toUpdateInput(draft({ condition: 'below' }))).toEqual({
      targetPrice: 0.15,
      condition: 'below',
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
    });
  });

  it('round-trips a rule into the edit form', () => {
    const existing = rule({ symbol: 'USDC', targetPrice: 1, cooldownMinutes: 30 });
    expect(draftFromRule(existing)).toEqual({
      symbol: 'USDC',
      targetPrice: '1',
      condition: 'above',
      cooldownMinutes: '30',
    });
  });

  it('prefills only the asset for an asset-originated draft', () => {
    expect(prefillDraftFromAsset({ code: 'xlm' })).toEqual({
      symbol: 'XLM',
      targetPrice: '',
      condition: 'above',
      cooldownMinutes: String(DEFAULT_COOLDOWN_MINUTES),
    });
    expect(prefillDraftFromAsset({}).symbol).toBe('');
  });
});

describe('toRule', () => {
  it('coerces decimal strings and normalizes the symbol', () => {
    const parsed = toRule(rawRule({ targetPrice: '0.10510000', cooldownMinutes: 15 }));
    expect(parsed.symbol).toBe('XLM');
    expect(parsed.targetPrice).toBeCloseTo(0.1051, 8);
    expect(parsed.cooldownMinutes).toBe(15);
  });
});

describe('formatTargetPrice', () => {
  it('renders at least two decimals and trims trailing zeros', () => {
    expect(formatTargetPrice(0.15)).toBe('$0.15');
    expect(formatTargetPrice(0.1051)).toBe('$0.1051');
    expect(formatTargetPrice(1)).toBe('$1.00');
    expect(formatTargetPrice(67241)).toBe('$67241.00');
  });

  it('degrades safely for a non-finite target', () => {
    expect(formatTargetPrice(Number.NaN)).toBe('$0.00');
  });
});

describe('alertStatus', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z');

  it('is active when enabled and not recently fired', () => {
    expect(alertStatus(rule(), now)).toBe('active');
    expect(alertStatusLabel('active')).toBe('Active');
  });

  it('is triggered only within the badge window', () => {
    const fired = rule({ lastTriggeredAt: new Date(now - 5 * 60 * 1000).toISOString() });
    expect(alertStatus(fired, now)).toBe('triggered');
    expect(alertStatusLabel('triggered')).toBe('Triggered');

    const longAgo = rule({
      lastTriggeredAt: new Date(now - TRIGGERED_BADGE_WINDOW_MS - 1000).toISOString(),
    });
    expect(alertStatus(longAgo, now)).toBe('active');
  });

  it('is muted when the rule is disabled, even if it just fired', () => {
    const muted = rule({
      isActive: false,
      lastTriggeredAt: new Date(now).toISOString(),
    });
    expect(alertStatus(muted, now)).toBe('muted');
    expect(alertStatusLabel('muted')).toBe('Muted');
  });

  it('treats an unparseable trigger timestamp as not triggered', () => {
    expect(alertStatus(rule({ lastTriggeredAt: 'garbage' }), now)).toBe('active');
  });
});

describe('delivery preferences', () => {
  it('defaults to enabled because the backend preference defaults to true', () => {
    expect(deliveryEnabled(undefined)).toBe(true);
    expect(deliveryEnabled({})).toBe(true);
    expect(deliveryEnabled({ priceAlerts: true })).toBe(true);
    expect(deliveryEnabled({ priceAlerts: false })).toBe(false);
  });

  it('reports a rule as undeliverable when muted or globally disabled', () => {
    expect(alertWillDeliver(rule(), { priceAlerts: true })).toBe(true);
    expect(alertWillDeliver(rule(), { priceAlerts: false })).toBe(false);
    expect(alertWillDeliver(rule({ isActive: false }), { priceAlerts: true })).toBe(false);
  });
});

describe('describePriceAlert', () => {
  it('renders symbol, condition and target', () => {
    expect(describePriceAlert(rule())).toBe('XLM above $0.15');
    expect(describePriceAlert(rule({ condition: 'below', targetPrice: 1 }))).toBe('XLM below $1.00');
  });
});

describe('PriceAlertRepository', () => {
  it('lists and normalizes the user rules', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValue({ success: true, data: [rawRule()] });
    const { queue } = fakeQueue();

    const result = await repository(transport, queue).list();

    expect(calls.get).toHaveBeenCalledWith('/price-alerts');
    expect(result.fromCache).toBe(false);
    expect(result.pendingCount).toBe(0);
    expect(result.rules[0].symbol).toBe('XLM');
    expect(result.rules[0].targetPrice).toBeCloseTo(0.15, 8);
  });

  it('reports a server rejection without inventing data', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValue({
      success: false,
      error: { message: 'Unauthorized', statusCode: 401, error: 'HttpError' },
    });
    const { queue } = fakeQueue();

    const result = await repository(transport, queue).list();

    expect(result.error?.statusCode).toBe(401);
    expect(result.rules).toEqual([]);
    expect(result.fromCache).toBe(false);
  });

  it('falls back to the last successful list when the transport fails', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValueOnce({ success: true, data: [rawRule()] });
    const { queue } = fakeQueue();

    const repo = repository(transport, queue);
    await repo.list();

    calls.get.mockResolvedValueOnce({
      success: false,
      error: { message: 'Network request failed', error: 'NetworkError' },
    });
    const offline = await repo.list();

    expect(offline.fromCache).toBe(true);
    expect(offline.rules).toHaveLength(1);
    // Cached data means the screen has something to render, so no error banner.
    expect(offline.error).toBeUndefined();
  });

  it('does not hit the network while offline', async () => {
    const { calls, transport } = fakeTransport();
    const { queue } = fakeQueue();
    online = false;

    const result = await repository(transport, queue).list();

    expect(calls.get).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.error?.error).toBe('NetworkError');
  });

  it('creates a rule online', async () => {
    const { calls, transport } = fakeTransport();
    calls.post.mockResolvedValue({ success: true, data: rawRule({ id: 'rule-9' }) });
    const { queue, items } = fakeQueue();

    const result = await repository(transport, queue).create(draft());

    expect(calls.post).toHaveBeenCalledWith('/price-alerts', {
      symbol: 'XLM',
      targetPrice: 0.15,
      condition: 'above',
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
    });
    expect(result.queued).toBe(false);
    expect(result.rule?.id).toBe('rule-9');
    expect(items).toHaveLength(0);
  });

  it('refuses to submit an invalid draft without calling the API', async () => {
    const { calls, transport } = fakeTransport();
    const { queue, items } = fakeQueue();

    const result = await repository(transport, queue).create(draft({ targetPrice: '0' }));

    expect(calls.post).not.toHaveBeenCalled();
    expect(result.error?.error).toBe('ValidationError');
    expect(items).toHaveLength(0);
  });

  it('queues a creation while offline and shows it optimistically', async () => {
    const { calls, transport } = fakeTransport();
    const { queue, items } = fakeQueue();
    online = false;

    const result = await repository(transport, queue, {
      now: () => Date.parse('2026-09-28T12:00:00.000Z'),
      newId: () => 'abc',
    }).create(draft());

    expect(calls.post).not.toHaveBeenCalled();
    expect(result.queued).toBe(true);
    expect(result.rule?.id).toBe(`${PENDING_RULE_PREFIX}abc`);
    expect(isPendingRule(result.rule as PriceAlertRule)).toBe(true);
    expect(items).toEqual([
      {
        type: PRICE_ALERT_MUTATIONS.create,
        payload: {
          symbol: 'XLM',
          targetPrice: 0.15,
          condition: 'above',
          cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
          localId: `${PENDING_RULE_PREFIX}abc`,
        },
        id: 'm1',
        createdAt: new Date(0).toISOString(),
      },
    ]);
  });

  it('keeps queued creations visible across a refresh', async () => {
    const { calls, transport } = fakeTransport();
    const { queue } = fakeQueue();

    const repo = repository(transport, queue, { newId: () => 'abc' });
    online = false;
    await repo.create(draft());

    // Coming back online: the server list does not know about the pending rule yet.
    online = true;
    calls.get.mockResolvedValue({ success: true, data: [rawRule({ id: 'rule-1' })] });
    const refreshed = await repo.list();

    expect(refreshed.rules.map((r) => r.id)).toEqual(['rule-1', `${PENDING_RULE_PREFIX}abc`]);
    expect(refreshed.pendingCount).toBe(1);
  });

  it('queues an update while offline and applies it optimistically', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValue({ success: true, data: [rawRule({ id: 'rule-1' })] });
    const { queue, items } = fakeQueue();

    const repo = repository(transport, queue);
    await repo.list();

    online = false;
    const result = await repo.update('rule-1', { isActive: false, targetPrice: 2 });

    expect(result.queued).toBe(true);
    expect(result.rule?.isActive).toBe(false);
    expect(result.rule?.targetPrice).toBe(2);
    expect(items).toEqual([
      {
        type: PRICE_ALERT_MUTATIONS.update,
        payload: { id: 'rule-1', patch: { isActive: false, targetPrice: 2 } },
        id: 'm1',
        createdAt: new Date(0).toISOString(),
      },
    ]);
  });

  it('reports an update for a rule that is no longer listed', async () => {
    const { calls, transport } = fakeTransport();
    const { queue } = fakeQueue();
    online = false;

    const result = await repository(transport, queue).update('gone', { isActive: false });

    expect(result.queued).toBe(false);
    expect(result.error?.error).toBe('NotFoundError');
    expect(calls.patch).not.toHaveBeenCalled();
  });

  it('deletes a rule online', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValue({ success: true, data: [rawRule()] });
    calls.delete.mockResolvedValue({ success: true });
    const { queue, items } = fakeQueue();

    const repo = repository(transport, queue);
    await repo.list();
    const result = await repo.remove('rule-1');

    expect(calls.delete).toHaveBeenCalledWith('/price-alerts/rule-1');
    expect(result).toEqual({ removed: true, queued: false });
    expect(repo.snapshot()).toEqual([]);
    expect(items).toHaveLength(0);
  });

  it('queues a deletion while offline', async () => {
    const { calls, transport } = fakeTransport();
    calls.get.mockResolvedValue({ success: true, data: [rawRule()] });
    const { queue, items } = fakeQueue();

    const repo = repository(transport, queue);
    await repo.list();

    online = false;
    const result = await repo.remove('rule-1');

    expect(result).toEqual({ removed: true, queued: true });
    expect(repo.snapshot()).toEqual([]);
    expect(items[0]).toMatchObject({
      type: PRICE_ALERT_MUTATIONS.remove,
      payload: { id: 'rule-1' },
    });
  });

  it('replays queued mutations in FIFO order', async () => {
    const { calls, transport } = fakeTransport();
    const { queue, items } = fakeQueue();

    const repo = repository(transport, queue, { newId: () => 'a' });
    online = false;
    const created = await repo.create(draft());
    await repo.update(created.rule?.id ?? '', { targetPrice: 0.2 });

    expect(items).toHaveLength(2);

    calls.post.mockResolvedValue({ success: true, data: rawRule({ id: 'rule-1' }) });
    calls.patch.mockResolvedValue({
      success: true,
      data: rawRule({ id: 'rule-1', targetPrice: '0.2' }),
    });

    const flush = await repo.flushPending();

    expect(flush).toEqual({ applied: 2, failed: 0, blocked: false });
    expect(calls.post.mock.calls[0][0]).toBe('/price-alerts');
    // The queued update was written against the optimistic id; once the create
    // landed it must target the server's row instead.
    expect(calls.patch.mock.calls[0][0]).toBe('/price-alerts/rule-1');
    expect(calls.patch.mock.calls[0][1]).toEqual({ targetPrice: 0.2 });
    expect(items).toHaveLength(0);
    // The optimistic placeholder is replaced by the real row.
    expect(repo.snapshot().map((r) => r.id)).toEqual(['rule-1']);
  });

  it('keeps the backlog in order when a replay fails part-way through', async () => {
    const { calls, transport } = fakeTransport();
    const { queue, items } = fakeQueue();

    const repo = repository(transport, queue);
    online = false;
    await repo.create(draft());
    await repo.create(draft({ symbol: 'USDC' }));
    await repo.create(draft({ symbol: 'AQUA' }));

    calls.post.mockResolvedValueOnce({ success: true, data: rawRule({ id: 'rule-1' }) });
    calls.post.mockResolvedValueOnce({
      success: false,
      error: { message: 'Network request failed', error: 'NetworkError' },
    });

    const flush = await repo.flushPending();

    expect(flush).toEqual({ applied: 1, failed: 1, blocked: true });
    // The failed create and everything behind it stay queued, in their original
    // order, and the third create was never attempted.
    expect(items.map((m) => (m.payload as { symbol: string }).symbol)).toEqual(['USDC', 'AQUA']);
    expect(calls.post).toHaveBeenCalledTimes(2);
  });

  it('drops an unknown mutation type rather than blocking the queue forever', async () => {
    const { calls, transport } = fakeTransport();
    const { queue } = fakeQueue();
    await queue.enqueue({ type: 'something.else', payload: {} });

    const flush = await repository(transport, queue).flushPending();

    expect(flush).toEqual({ applied: 1, failed: 0, blocked: false });
    expect(calls.post).not.toHaveBeenCalled();
  });
});
