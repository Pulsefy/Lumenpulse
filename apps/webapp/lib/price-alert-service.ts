import { clientConfig } from '@/lib/config';

export type PriceAlertCondition = 'above' | 'below';

export const PRICE_ALERT_CONDITIONS: readonly PriceAlertCondition[] = ['above', 'below'];

/**
 * Delivery channel chosen in the rule form.
 *
 * The backend does not store a channel per rule yet: price alerts are
 * delivered on the channels in the user's notification preferences. The form
 * validates this field but it is never sent to the API.
 */
export type PriceAlertChannel = 'in_app' | 'email' | 'push';

export const PRICE_ALERT_CHANNELS: readonly { value: PriceAlertChannel; label: string }[] = [
  { value: 'in_app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'push', label: 'Push' },
];

/**
 * Display state of a rule, derived from backend fields:
 * - muted: the rule is disabled (`isActive === false`)
 * - triggered: it fired recently and is still inside its cooldown window
 * - active: it is being evaluated and can fire
 */
export type PriceAlertState = 'active' | 'triggered' | 'muted';

export interface PriceAlertRule {
  id: string;
  userId: string;
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  isActive: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePriceAlertPayload {
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  cooldownMinutes?: number;
}

/** Fields accepted by PATCH /price-alerts/:id (symbol is not updatable). */
export interface UpdatePriceAlertPayload {
  targetPrice?: number;
  condition?: PriceAlertCondition;
  isActive?: boolean;
  cooldownMinutes?: number;
}

const UPDATABLE_FIELDS: readonly (keyof UpdatePriceAlertPayload)[] = [
  'targetPrice',
  'condition',
  'isActive',
  'cooldownMinutes',
];

export class PriceAlertApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PriceAlertApiError';
  }
}

/**
 * `targetPrice` is a Postgres decimal column, so the API serialises it as a
 * string. Coerce numeric fields so the UI can compare and format them.
 */
export function normalizePriceAlertRule(raw: Record<string, unknown>): PriceAlertRule {
  return {
    id: String(raw.id),
    userId: String(raw.userId ?? ''),
    symbol: String(raw.symbol ?? '').toUpperCase(),
    targetPrice: Number(raw.targetPrice),
    condition: raw.condition === 'below' ? 'below' : 'above',
    isActive: Boolean(raw.isActive),
    cooldownMinutes: Number(raw.cooldownMinutes ?? 60),
    lastTriggeredAt: (raw.lastTriggeredAt as string | null | undefined) ?? null,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

export function getPriceAlertState(rule: PriceAlertRule, now: number = Date.now()): PriceAlertState {
  if (!rule.isActive) return 'muted';
  if (rule.lastTriggeredAt) {
    const triggeredAt = new Date(rule.lastTriggeredAt).getTime();
    const cooldownMs = rule.cooldownMinutes * 60 * 1000;
    if (!Number.isNaN(triggeredAt) && now - triggeredAt < cooldownMs) return 'triggered';
  }
  return 'active';
}

// ─── Form validation ─────────────────────────────────────────────────────────

export interface PriceAlertFormValues {
  symbol: string;
  targetPrice: string;
  condition: string;
  channel: string;
  cooldownMinutes: string;
}

export type PriceAlertFormErrors = Partial<Record<keyof PriceAlertFormValues, string>>;

export type PriceAlertFormResult =
  | { valid: true; payload: CreatePriceAlertPayload; errors: Record<string, never> }
  | { valid: false; errors: PriceAlertFormErrors };

/** Stellar asset codes are 1–12 alphanumeric characters. */
const SYMBOL_PATTERN = /^[A-Z0-9]{1,12}$/;
/** Matches the backend column: decimal(20, 8). */
const MAX_DECIMALS = 8;

export function validatePriceAlertForm(values: PriceAlertFormValues): PriceAlertFormResult {
  const errors: PriceAlertFormErrors = {};

  const symbol = values.symbol.trim().toUpperCase();
  if (!symbol) {
    errors.symbol = 'Enter an asset symbol.';
  } else if (!SYMBOL_PATTERN.test(symbol)) {
    errors.symbol = 'Use 1–12 letters or digits (e.g. XLM, USDC).';
  }

  const rawPrice = values.targetPrice.trim();
  const targetPrice = Number(rawPrice);
  if (!rawPrice) {
    errors.targetPrice = 'Enter a threshold price.';
  } else if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    errors.targetPrice = 'Threshold must be a number greater than 0.';
  } else if ((rawPrice.split('.')[1]?.length ?? 0) > MAX_DECIMALS) {
    errors.targetPrice = `Use at most ${MAX_DECIMALS} decimal places.`;
  }

  if (!PRICE_ALERT_CONDITIONS.includes(values.condition as PriceAlertCondition)) {
    errors.condition = 'Choose whether to alert above or below the threshold.';
  }

  if (!PRICE_ALERT_CHANNELS.some((c) => c.value === values.channel)) {
    errors.channel = 'Choose a notification channel.';
  }

  const rawCooldown = values.cooldownMinutes.trim();
  const cooldownMinutes = rawCooldown ? Number(rawCooldown) : undefined;
  if (cooldownMinutes !== undefined && (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 1)) {
    errors.cooldownMinutes = 'Cooldown must be a whole number of minutes (1 or more).';
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: {},
    payload: {
      symbol,
      targetPrice,
      condition: values.condition as PriceAlertCondition,
      ...(cooldownMinutes !== undefined ? { cooldownMinutes } : {}),
    },
  };
}

// ─── API client ──────────────────────────────────────────────────────────────

async function toApiError(res: Response, fallback: string): Promise<PriceAlertApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return new PriceAlertApiError(message || fallback, res.status);
}

export class PriceAlertApiService {
  private static readonly BASE_URL = clientConfig.apiUrl;

  private static getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof document === 'undefined') return headers;
    const match = document.cookie.split('; ').find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  static async list(): Promise<PriceAlertRule[]> {
    const res = await fetch(`${this.BASE_URL}/price-alerts`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to load price alerts');
    const data = (await res.json()) as Record<string, unknown>[];
    return data.map(normalizePriceAlertRule);
  }

  static async get(id: string): Promise<PriceAlertRule> {
    const res = await fetch(`${this.BASE_URL}/price-alerts/${encodeURIComponent(id)}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to load price alert');
    return normalizePriceAlertRule(await res.json());
  }

  static async create(payload: CreatePriceAlertPayload): Promise<PriceAlertRule> {
    const res = await fetch(`${this.BASE_URL}/price-alerts`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to create price alert');
    return normalizePriceAlertRule(await res.json());
  }

  static async update(id: string, payload: UpdatePriceAlertPayload): Promise<PriceAlertRule> {
    // Send only fields the update DTO accepts, so extra client-side fields
    // are never rejected by the backend's validation.
    const body: UpdatePriceAlertPayload = {};
    for (const key of UPDATABLE_FIELDS) {
      if (payload[key] !== undefined) (body as Record<string, unknown>)[key] = payload[key];
    }

    const res = await fetch(`${this.BASE_URL}/price-alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to update price alert');
    return normalizePriceAlertRule(await res.json());
  }

  static async remove(id: string): Promise<void> {
    const res = await fetch(`${this.BASE_URL}/price-alerts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to delete price alert');
  }
}
