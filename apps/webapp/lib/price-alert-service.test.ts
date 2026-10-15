import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PriceAlertApiError,
  PriceAlertApiService,
  PriceAlertFormValues,
  PriceAlertRule,
  getPriceAlertState,
  validatePriceAlertForm,
} from './price-alert-service';

const RAW_RULE = {
  id: 'rule-1',
  userId: 'user-1',
  symbol: 'XLM',
  // Postgres decimal columns come back as strings.
  targetPrice: '0.15000000',
  condition: 'above',
  isActive: true,
  cooldownMinutes: 60,
  lastTriggeredAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'auth-token=test-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe('PriceAlertApiService', () => {
  it('list: GETs /price-alerts with the bearer token and normalises numbers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([RAW_RULE]));

    const rules = await PriceAlertApiService.list();

    const { url, init } = lastCall();
    expect(url).toMatch(/\/price-alerts$/);
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(rules).toHaveLength(1);
    expect(rules[0].targetPrice).toBe(0.15);
    expect(typeof rules[0].targetPrice).toBe('number');
  });

  it('get: GETs /price-alerts/:id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RAW_RULE));

    const rule = await PriceAlertApiService.get('rule-1');

    expect(lastCall().url).toMatch(/\/price-alerts\/rule-1$/);
    expect(rule.id).toBe('rule-1');
  });

  it('create: POSTs the payload to /price-alerts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RAW_RULE, 201));

    const payload = { symbol: 'XLM', targetPrice: 0.15, condition: 'above' as const, cooldownMinutes: 60 };
    const rule = await PriceAlertApiService.create(payload);

    const { url, init } = lastCall();
    expect(url).toMatch(/\/price-alerts$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(rule.symbol).toBe('XLM');
  });

  it('update: PATCHes only fields the update DTO accepts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...RAW_RULE, isActive: false }));

    const rule = await PriceAlertApiService.update('rule-1', {
      isActive: false,
      // Extra fields must not be forwarded to the backend.
      ...({ symbol: 'BTC', id: 'other' } as object),
    });

    const { url, init } = lastCall();
    expect(url).toMatch(/\/price-alerts\/rule-1$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false });
    expect(rule.isActive).toBe(false);
  });

  it('remove: DELETEs /price-alerts/:id and accepts 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(PriceAlertApiService.remove('rule-1')).resolves.toBeUndefined();

    const { url, init } = lastCall();
    expect(url).toMatch(/\/price-alerts\/rule-1$/);
    expect(init.method).toBe('DELETE');
  });

  it('throws a PriceAlertApiError with the status and the joined validation messages', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: ['targetPrice must be a number', 'symbol must be a string'] }, 400),
    );

    const error = await PriceAlertApiService.create({
      symbol: 'XLM',
      targetPrice: 1,
      condition: 'above',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PriceAlertApiError);
    expect((error as PriceAlertApiError).status).toBe(400);
    expect((error as PriceAlertApiError).message).toBe(
      'targetPrice must be a number, symbol must be a string',
    );
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(PriceAlertApiService.get('missing')).rejects.toThrow('Failed to load price alert');
  });
});

describe('validatePriceAlertForm', () => {
  const valid: PriceAlertFormValues = {
    symbol: ' xlm ',
    targetPrice: '0.15',
    condition: 'above',
    channel: 'email',
    cooldownMinutes: '30',
  };

  it('accepts a valid form and builds a normalised payload without the channel', () => {
    const result = validatePriceAlertForm(valid);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual({
        symbol: 'XLM',
        targetPrice: 0.15,
        condition: 'above',
        cooldownMinutes: 30,
      });
      expect(result.payload).not.toHaveProperty('channel');
    }
  });

  it('omits cooldown when left blank so the backend default applies', () => {
    const result = validatePriceAlertForm({ ...valid, cooldownMinutes: '' });
    expect(result.valid && result.payload).not.toHaveProperty('cooldownMinutes');
  });

  it.each([
    ['symbol', { symbol: '' }],
    ['symbol', { symbol: 'NOT A SYMBOL!' }],
    ['targetPrice', { targetPrice: '' }],
    ['targetPrice', { targetPrice: 'abc' }],
    ['targetPrice', { targetPrice: '0' }],
    ['targetPrice', { targetPrice: '-1' }],
    ['targetPrice', { targetPrice: '0.123456789' }],
    ['condition', { condition: 'sideways' }],
    ['channel', { channel: '' }],
    ['channel', { channel: 'carrier-pigeon' }],
    ['cooldownMinutes', { cooldownMinutes: '0' }],
    ['cooldownMinutes', { cooldownMinutes: '1.5' }],
  ])('rejects an invalid %s (%o)', (field, override) => {
    const result = validatePriceAlertForm({ ...valid, ...override });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveProperty(field);
  });
});

describe('getPriceAlertState', () => {
  const now = new Date('2026-01-01T12:00:00.000Z').getTime();
  const base: PriceAlertRule = {
    id: 'r',
    userId: 'u',
    symbol: 'XLM',
    targetPrice: 1,
    condition: 'above',
    isActive: true,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    createdAt: '',
    updatedAt: '',
  };

  it('is muted when the rule is inactive, even if it fired recently', () => {
    expect(
      getPriceAlertState({ ...base, isActive: false, lastTriggeredAt: '2026-01-01T11:59:00.000Z' }, now),
    ).toBe('muted');
  });

  it('is triggered while inside the cooldown window', () => {
    expect(getPriceAlertState({ ...base, lastTriggeredAt: '2026-01-01T11:30:00.000Z' }, now)).toBe('triggered');
  });

  it('returns to active once the cooldown has elapsed', () => {
    expect(getPriceAlertState({ ...base, lastTriggeredAt: '2026-01-01T10:00:00.000Z' }, now)).toBe('active');
  });

  it('is active when it has never fired', () => {
    expect(getPriceAlertState(base, now)).toBe('active');
  });
});
