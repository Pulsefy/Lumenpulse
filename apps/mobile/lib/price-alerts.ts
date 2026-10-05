/**
 * Price alert management (issue #1404).
 *
 * The backend exposes full CRUD at `/price-alerts`
 * (`apps/backend/src/price-alert/price-alert-rule.controller.ts`, entity
 * `PriceAlertRule`), and the mobile app already owns the push token lifecycle
 * (`lib/push-token.ts`, `lib/api.ts` → `notificationDevicesApi`). Today
 * `app/settings/notification-settings.tsx` only toggles the `priceAlerts`
 * preference with no way to manage the rules themselves.
 *
 * This module owns:
 *  1. The wire types and the create/update payload shapes the backend accepts.
 *  2. Draft validation, so the screen shows field errors instead of letting the
 *     API reject the rule (`@Min(0)`, `@MaxLength(50)`, `@Min(1)` cooldowns).
 *  3. The list derivations: the rule's status (active / triggered / muted) and
 *     its human-readable description.
 *  4. `PriceAlertRepository` — the read/write path, which defers writes to
 *     `lib/mutation-queue.ts` when the device is offline instead of losing them,
 *     and replays them (in order) once connectivity returns.
 *
 * Delivery itself is not bypassed: alerts are still fanned out by the backend,
 * which honours the `notifications.priceAlerts` preference. `deliveryEnabled`
 * lets the screen surface that gate instead of silently doing nothing.
 */

import { apiClient, ApiError, ApiResponse } from './api-client';
import { cache } from './cache';
import { mutationQueue } from './mutation-queue';
import type { PendingMutation } from './mutation-queue';

/** `PriceAlertCondition` in `apps/backend/src/price-alert/entities/price-alert-rule.entity.ts`. */
export type PriceAlertCondition = 'above' | 'below';

/** Lifecycle state surfaced in the alert list. */
export type PriceAlertStatus = 'active' | 'triggered' | 'muted';

export const PRICE_ALERT_CONDITIONS: PriceAlertCondition[] = ['above', 'below'];

/** Default cooldown when the user leaves the field empty (`@Column` default). */
export const DEFAULT_COOLDOWN_MINUTES = 60;

/** Backend validation bounds (`@Min(1)` on an `int` column). */
export const MIN_COOLDOWN_MINUTES = 1;
export const MAX_COOLDOWN_MINUTES = 24 * 60;

/** A rule that fired within this window is badged as recently triggered. */
export const TRIGGERED_BADGE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Backend `targetPrice` column is `decimal(20, 8)`. */
export const MAX_TARGET_PRICE_DECIMALS = 8;

const SYMBOL_PATTERN = /^[A-Z0-9]{1,12}$/;

/** A price alert rule as returned by `GET /price-alerts`. */
export interface PriceAlertRule {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  isActive: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The raw row shape — TypeORM returns `decimal` columns as strings. */
export interface RawPriceAlertRule {
  id: string;
  symbol: string;
  targetPrice: string | number;
  condition: PriceAlertCondition;
  isActive: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body accepted by `POST /price-alerts` (`CreatePriceAlertRuleDto`). */
export interface CreatePriceAlertInput {
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  cooldownMinutes?: number;
}

/** Body accepted by `PATCH /price-alerts/:id` (`UpdatePriceAlertRuleDto`). */
export interface UpdatePriceAlertInput {
  targetPrice?: number;
  condition?: PriceAlertCondition;
  isActive?: boolean;
  cooldownMinutes?: number;
}

/** Form state — every field is a string because it is bound to a `TextInput`. */
export interface PriceAlertDraft {
  symbol: string;
  targetPrice: string;
  condition: PriceAlertCondition;
  cooldownMinutes: string;
}

export interface PriceAlertDraftErrors {
  symbol?: string;
  targetPrice?: string;
  cooldownMinutes?: string;
}

/** Mutable subset of `UserPreferences.notifications`. */
export interface PriceAlertDeliveryPreferences {
  priceAlerts?: boolean;
}

/** Whether the backend will actually deliver price alerts for this user. */
export function deliveryEnabled(preferences?: PriceAlertDeliveryPreferences | null): boolean {
  // The backend default for `priceAlerts` is true, so an absent preference
  // must not read as "disabled".
  return preferences?.priceAlerts !== false;
}

/** `XLM ` / `xlm` → `XLM`. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isPriceAlertCondition(value: unknown): value is PriceAlertCondition {
  return typeof value === 'string' && (PRICE_ALERT_CONDITIONS as string[]).includes(value);
}

export function emptyDraft(symbol = '', condition: PriceAlertCondition = 'above'): PriceAlertDraft {
  return { symbol, targetPrice: '', condition, cooldownMinutes: String(DEFAULT_COOLDOWN_MINUTES) };
}

/**
 * Prefills a draft from an asset surface. Only the fields the asset actually
 * determines are prefilled: the target price stays empty because a threshold
 * cannot be inferred from a spot price.
 */
export function prefillDraftFromAsset(asset: { code?: string; symbol?: string }): PriceAlertDraft {
  return emptyDraft(normalizeSymbol(asset.code ?? asset.symbol ?? ''));
}

/** Counts the digits after the decimal point in a numeric string. */
function decimalPlaces(value: string): number {
  const [, fraction = ''] = value.split('.');
  return fraction.length;
}

/**
 * Validates a draft against the backend's DTO constraints.
 * Returns an empty object when the draft can be submitted.
 */
export function validatePriceAlertDraft(draft: PriceAlertDraft): PriceAlertDraftErrors {
  const errors: PriceAlertDraftErrors = {};

  const symbol = normalizeSymbol(draft.symbol);
  if (!symbol) {
    errors.symbol = 'Choose an asset';
  } else if (!SYMBOL_PATTERN.test(symbol)) {
    errors.symbol = 'Asset symbols are 1–12 letters or digits';
  }

  const rawPrice = draft.targetPrice.trim();
  if (!rawPrice) {
    errors.targetPrice = 'Enter a target price';
  } else if (!/^\d*\.?\d+$/.test(rawPrice)) {
    errors.targetPrice = 'Enter a price like 0.15';
  } else {
    const price = Number(rawPrice);
    if (!Number.isFinite(price)) {
      errors.targetPrice = 'Enter a valid price';
    } else if (price <= 0) {
      errors.targetPrice = 'Price must be greater than zero';
    } else if (decimalPlaces(rawPrice) > MAX_TARGET_PRICE_DECIMALS) {
      errors.targetPrice = `At most ${MAX_TARGET_PRICE_DECIMALS} decimal places`;
    }
  }

  const rawCooldown = draft.cooldownMinutes.trim();
  if (rawCooldown) {
    if (!/^\d+$/.test(rawCooldown)) {
      errors.cooldownMinutes = 'Whole minutes only';
    } else {
      const cooldown = Number(rawCooldown);
      if (cooldown < MIN_COOLDOWN_MINUTES) {
        errors.cooldownMinutes = `At least ${MIN_COOLDOWN_MINUTES} minute`;
      } else if (cooldown > MAX_COOLDOWN_MINUTES) {
        errors.cooldownMinutes = `At most ${MAX_COOLDOWN_MINUTES} minutes`;
      }
    }
  }

  return errors;
}

/** Whether a draft is submittable (no field errors). */
export function isDraftValid(draft: PriceAlertDraft): boolean {
  return Object.keys(validatePriceAlertDraft(draft)).length === 0;
}

/** Converts a valid draft into the `POST /price-alerts` body, or null. */
export function toCreateInput(draft: PriceAlertDraft): CreatePriceAlertInput | null {
  if (!isDraftValid(draft)) return null;

  const cooldown = draft.cooldownMinutes.trim();
  const input: CreatePriceAlertInput = {
    symbol: normalizeSymbol(draft.symbol),
    targetPrice: Number(draft.targetPrice.trim()),
    condition: draft.condition,
  };
  if (cooldown) input.cooldownMinutes = Number(cooldown);
  return input;
}

/** Converts a valid draft's editable fields into a `PATCH` body, or null. */
export function toUpdateInput(draft: PriceAlertDraft): UpdatePriceAlertInput | null {
  if (!isDraftValid(draft)) return null;

  const input: UpdatePriceAlertInput = {
    targetPrice: Number(draft.targetPrice.trim()),
    condition: draft.condition,
  };
  const cooldown = draft.cooldownMinutes.trim();
  if (cooldown) input.cooldownMinutes = Number(cooldown);
  return input;
}

/** Draft view of an existing rule, for the edit form. */
export function draftFromRule(rule: PriceAlertRule): PriceAlertDraft {
  return {
    symbol: rule.symbol,
    targetPrice: String(rule.targetPrice),
    condition: rule.condition,
    cooldownMinutes: String(rule.cooldownMinutes),
  };
}

/** Normalizes a raw row from the API (decimals arrive as strings). */
export function toRule(raw: RawPriceAlertRule): PriceAlertRule {
  return {
    ...raw,
    symbol: normalizeSymbol(raw.symbol),
    targetPrice: Number(raw.targetPrice),
    cooldownMinutes: Number(raw.cooldownMinutes),
  };
}

/** `$0.15`, `$0.1051`, `$67241.00` — trailing zeros trimmed, min 2 decimals. */
export function formatTargetPrice(targetPrice: number): string {
  if (!Number.isFinite(targetPrice)) return '$0.00';

  const fixed = targetPrice.toFixed(MAX_TARGET_PRICE_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
  const [whole, fraction = ''] = fixed.split('.');
  const padded = fraction.length < 2 ? fraction.padEnd(2, '0') : fraction;
  return `$${whole}.${padded}`;
}

/** Whether a rule fired recently enough to badge it as triggered. */
export function isRecentlyTriggered(
  rule: PriceAlertRule,
  now: number = Date.now(),
  windowMs: number = TRIGGERED_BADGE_WINDOW_MS,
): boolean {
  if (!rule.lastTriggeredAt) return false;
  const timestamp = Date.parse(rule.lastTriggeredAt);
  if (Number.isNaN(timestamp)) return false;
  return now - timestamp <= windowMs;
}

/**
 * The rule's displayed state: a disabled rule is muted even if it fired
 * recently, and a recently-fired rule is triggered.
 */
export function alertStatus(
  rule: PriceAlertRule,
  now: number = Date.now(),
  windowMs: number = TRIGGERED_BADGE_WINDOW_MS,
): PriceAlertStatus {
  if (!rule.isActive) return 'muted';
  return isRecentlyTriggered(rule, now, windowMs) ? 'triggered' : 'active';
}

/** Status label rendered in the list. */
export function alertStatusLabel(status: PriceAlertStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'triggered':
      return 'Triggered';
    case 'muted':
      return 'Muted';
  }
}

/** `XLM above $0.1500` — the rule's one-line description. */
export function describePriceAlert(rule: PriceAlertRule): string {
  return `${rule.symbol} ${rule.condition} ${formatTargetPrice(rule.targetPrice)}`;
}

/** Whether a signal fired by this rule would have been delivered. */
export function alertWillDeliver(
  rule: PriceAlertRule,
  preferences?: PriceAlertDeliveryPreferences | null,
): boolean {
  return rule.isActive && deliveryEnabled(preferences);
}

// ─── Repository ───────────────────────────────────────────────────────────────

/** Mutation types written to `lib/mutation-queue.ts` for deferred alerts work. */
export const PRICE_ALERT_MUTATIONS = {
  create: 'price_alert.create',
  update: 'price_alert.update',
  remove: 'price_alert.delete',
} as const;

export type PriceAlertMutationType =
  (typeof PRICE_ALERT_MUTATIONS)[keyof typeof PRICE_ALERT_MUTATIONS];

/** The subset of `ApiClient` the repository uses. */
export interface PriceAlertTransport {
  get<T>(endpoint: string): Promise<ApiResponse<T>>;
  post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>>;
  patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>>;
  delete<T>(endpoint: string): Promise<ApiResponse<T>>;
}

/** The subset of `mutationQueue` the repository uses. */
export interface PriceAlertQueue {
  enqueue(mutation: { type: string; payload: Record<string, unknown> }): Promise<PendingMutation>;
  dequeue(): Promise<PendingMutation | null>;
}

export interface PriceAlertRepositoryDeps {
  transport?: PriceAlertTransport;
  queue?: PriceAlertQueue;
  isOnline?: () => boolean;
  now?: () => number;
  newId?: () => string;
}

export interface PriceAlertListResult {
  rules: PriceAlertRule[];
  /** Optimistic, not-yet-synced rules included in `rules`. */
  pendingCount: number;
  /** True when the list was served without a successful round trip. */
  fromCache: boolean;
  error?: ApiError;
}

export interface PriceAlertMutationResult {
  rule: PriceAlertRule | null;
  /** True when the write was deferred to the offline queue. */
  queued: boolean;
  error?: ApiError;
}

export interface PriceAlertRemovalResult {
  removed: boolean;
  queued: boolean;
  error?: ApiError;
}

export interface PriceAlertFlushResult {
  applied: number;
  failed: number;
  /** True when a mutation failed and the rest of the queue was left for later. */
  blocked: boolean;
}

/** Outcome of replaying a single queued mutation. */
interface MutationOutcome {
  ok: boolean;
  /** Server id of a created rule, used to remap queued follow-up writes. */
  createdId?: string;
  createdRule?: PriceAlertRule;
}

/** Prefix marking a rule that exists only locally until it syncs. */
export const PENDING_RULE_PREFIX = 'pending:';

/**
 * Payload key carrying the optimistic rule id on a queued create. It lets a
 * replay remap a queued follow-up update/delete onto the id the server assigns,
 * and is stripped before the request body is sent.
 */
export const LOCAL_ID_KEY = 'localId';

export function isPendingRule(rule: PriceAlertRule): boolean {
  return rule.id.startsWith(PENDING_RULE_PREFIX);
}

/**
 * The local id a queued mutation targets: the optimistic id recorded on a
 * create, or the rule id on an update/delete.
 */
function mutationTargetId(mutation: PendingMutation): string | null {
  const fromCreate = mutation.payload[LOCAL_ID_KEY];
  if (typeof fromCreate === 'string' && fromCreate.length > 0) return fromCreate;

  const id = mutation.payload.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Read/write path for price alerts.
 *
 * Offline policy: reads fall back to the last successful list, and writes are
 * recorded as optimistic rules plus a queue entry, so a user on a plane can
 * still set an alert and have it land once the device reconnects.
 */
export class PriceAlertRepository {
  private readonly transport: PriceAlertTransport;
  private readonly queue: PriceAlertQueue;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;
  private readonly newId: () => string;

  /** Last successfully fetched rules, plus optimistic offline writes. */
  private rules: PriceAlertRule[] = [];

  constructor(deps: PriceAlertRepositoryDeps = {}) {
    this.transport = deps.transport ?? apiClient;
    this.queue = deps.queue ?? mutationQueue;
    this.isOnline = deps.isOnline ?? (() => cache.isOnlineStatus());
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => Math.random().toString(36).slice(2, 10));
  }

  /** Rules currently held in memory (server rows + unsynced writes). */
  snapshot(): PriceAlertRule[] {
    return this.rules;
  }

  pendingCount(): number {
    return this.rules.filter(isPendingRule).length;
  }

  private offlineError(error?: ApiError): ApiError {
    return error ?? { message: 'No internet connection', error: 'NetworkError' };
  }

  private offlineList(error?: ApiError): PriceAlertListResult {
    return {
      rules: this.rules,
      pendingCount: this.pendingCount(),
      fromCache: true,
      error: this.rules.length > 0 ? undefined : this.offlineError(error),
    };
  }

  /**
   * Lists the user's rules. Falls back to the last successful read (with any
   * optimistic offline writes) when the device is offline or the request fails
   * for a transport reason.
   */
  async list(): Promise<PriceAlertListResult> {
    if (!this.isOnline()) return this.offlineList();

    const response = await this.transport.get<RawPriceAlertRule[]>('/price-alerts');
    if (response.success && Array.isArray(response.data)) {
      // Keep unsynced local rules visible across refreshes.
      const pending = this.rules.filter(isPendingRule);
      this.rules = [...response.data.map(toRule), ...pending];
      return { rules: this.rules, pendingCount: pending.length, fromCache: false };
    }

    // A server verdict (4xx/5xx) is authoritative; only transport failures
    // fall back to the cached list.
    if (response.error?.statusCode) {
      return {
        rules: this.rules,
        pendingCount: this.pendingCount(),
        fromCache: this.rules.length > 0,
        error: response.error,
      };
    }

    return this.offlineList(response.error);
  }

  /** Creates a rule, or queues the creation while offline. */
  async create(draft: PriceAlertDraft): Promise<PriceAlertMutationResult> {
    const input = toCreateInput(draft);
    if (!input) {
      return {
        rule: null,
        queued: false,
        error: { message: 'Fix the highlighted fields before saving', error: 'ValidationError' },
      };
    }

    if (!this.isOnline()) return this.queueCreate(input);

    const response = await this.transport.post<RawPriceAlertRule>('/price-alerts', input);
    if (response.success && response.data) {
      const rule = toRule(response.data);
      this.rules = [...this.rules, rule];
      return { rule, queued: false };
    }

    if (response.error?.statusCode) return { rule: null, queued: false, error: response.error };
    return this.queueCreate(input);
  }

  private async queueCreate(input: CreatePriceAlertInput): Promise<PriceAlertMutationResult> {
    const rule = this.optimisticRule(input);
    this.rules = [...this.rules, rule];
    await this.queue.enqueue({
      type: PRICE_ALERT_MUTATIONS.create,
      payload: { ...input, [LOCAL_ID_KEY]: rule.id },
    });
    return { rule, queued: true };
  }

  /** Applies an update, or queues it while offline. */
  async update(id: string, patch: UpdatePriceAlertInput): Promise<PriceAlertMutationResult> {
    if (!this.isOnline()) return this.queueUpdate(id, patch);

    const response = await this.transport.patch<RawPriceAlertRule>(`/price-alerts/${id}`, patch);
    if (response.success && response.data) {
      const rule = toRule(response.data);
      this.rules = this.rules.map((existing) => (existing.id === id ? rule : existing));
      return { rule, queued: false };
    }

    if (response.error?.statusCode) return { rule: null, queued: false, error: response.error };
    return this.queueUpdate(id, patch);
  }

  private async queueUpdate(
    id: string,
    patch: UpdatePriceAlertInput,
  ): Promise<PriceAlertMutationResult> {
    const existing = this.rules.find((rule) => rule.id === id) ?? null;
    if (!existing) {
      return {
        rule: null,
        queued: false,
        error: { message: 'That alert is no longer in the list', error: 'NotFoundError' },
      };
    }

    const rule: PriceAlertRule = { ...existing, ...patch, updatedAt: new Date(this.now()).toISOString() };
    this.rules = this.rules.map((candidate) => (candidate.id === id ? rule : candidate));
    await this.queue.enqueue({ type: PRICE_ALERT_MUTATIONS.update, payload: { id, patch } });
    return { rule, queued: true };
  }

  /** Deletes a rule, or queues the deletion while offline. */
  async remove(id: string): Promise<PriceAlertRemovalResult> {
    if (!this.isOnline()) return this.queueRemove(id);

    const response = await this.transport.delete<void>(`/price-alerts/${id}`);
    if (response.success) {
      this.rules = this.rules.filter((rule) => rule.id !== id);
      return { removed: true, queued: false };
    }

    if (response.error?.statusCode) return { removed: false, queued: false, error: response.error };
    return this.queueRemove(id);
  }

  private async queueRemove(id: string): Promise<PriceAlertRemovalResult> {
    const exists = this.rules.some((rule) => rule.id === id);
    if (!exists) {
      return {
        removed: false,
        queued: false,
        error: { message: 'That alert is no longer in the list', error: 'NotFoundError' },
      };
    }

    this.rules = this.rules.filter((rule) => rule.id !== id);
    await this.queue.enqueue({ type: PRICE_ALERT_MUTATIONS.remove, payload: { id } });
    return { removed: true, queued: true };
  }

  /**
   * Replays queued alert writes in FIFO order.
   *
   * The queue is drained into memory first so a failure cannot reorder the
   * backlog: the failed mutation and everything behind it are written back to
   * the queue in their original order and retried on the next attempt. That
   * keeps a `price_alert.update` from being applied before its own
   * `price_alert.create` — which would 404 against the server.
   *
   * A write queued against an optimistic rule (`pending:<id>`) is remapped to
   * the server id as soon as its create lands, so the follow-up update or
   * delete targets the real row.
   */
  async flushPending(): Promise<PriceAlertFlushResult> {
    const queued = await this.drainQueue();

    /** Locally generated rule id → the id the server assigned it. */
    const remapped = new Map<string, string>();

    let applied = 0;
    let failed = 0;
    let blocked = false;
    const deferred: PendingMutation[] = [];

    for (const mutation of queued) {
      if (blocked) {
        deferred.push(mutation);
        continue;
      }

      const localId = mutationTargetId(mutation);
      const resolvedId = localId ? remapped.get(localId) ?? localId : null;
      const outcome = await this.applyMutation(mutation.type, {
        ...mutation.payload,
        ...(localId && resolvedId && resolvedId !== localId ? { id: resolvedId } : {}),
      });

      if (!outcome.ok) {
        failed += 1;
        blocked = true;
        deferred.push(mutation);
        continue;
      }

      applied += 1;

      if (localId && outcome.createdId && outcome.createdId !== localId) {
        remapped.set(localId, outcome.createdId);
        this.reconcileCreated(localId, outcome.createdRule);
      }
    }

    for (const mutation of deferred) {
      await this.queue.enqueue({ type: mutation.type, payload: mutation.payload });
    }

    return { applied, failed, blocked };
  }

  private async drainQueue(): Promise<PendingMutation[]> {
    const mutations: PendingMutation[] = [];
    for (;;) {
      const mutation = await this.queue.dequeue();
      if (!mutation) break;
      mutations.push(mutation);
    }
    return mutations;
  }

  private async applyMutation(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<MutationOutcome> {
    switch (type) {
      case PRICE_ALERT_MUTATIONS.create: {
        // `localId` is queue bookkeeping, not part of `CreatePriceAlertRuleDto`.
        const { [LOCAL_ID_KEY]: _localId, ...body } = payload as Record<string, unknown> & {
          localId?: string;
        };
        const response = await this.transport.post<RawPriceAlertRule>('/price-alerts', body);
        if (!response.success) return { ok: false };
        return {
          ok: true,
          createdId: response.data?.id,
          createdRule: response.data ? toRule(response.data) : undefined,
        };
      }
      case PRICE_ALERT_MUTATIONS.update: {
        const id = String(payload.id ?? '');
        if (!id) return { ok: false };
        const response = await this.transport.patch<RawPriceAlertRule>(
          `/price-alerts/${id}`,
          payload.patch ?? {},
        );
        return { ok: response.success };
      }
      case PRICE_ALERT_MUTATIONS.remove: {
        const id = String(payload.id ?? '');
        if (!id) return { ok: false };
        const response = await this.transport.delete<void>(`/price-alerts/${id}`);
        return { ok: response.success };
      }
      default:
        // An unknown mutation type would block the queue forever.
        return { ok: true };
    }
  }

  /** Swaps an optimistic rule for the server row once its create lands. */
  private reconcileCreated(localId: string, rule?: PriceAlertRule): void {
    if (!rule) {
      this.rules = this.rules.filter((candidate) => candidate.id !== localId);
      return;
    }
    this.rules = this.rules.map((candidate) => (candidate.id === localId ? rule : candidate));
  }

  private optimisticRule(input: CreatePriceAlertInput): PriceAlertRule {
    const timestamp = new Date(this.now()).toISOString();
    return {
      id: `${PENDING_RULE_PREFIX}${this.newId()}`,
      symbol: input.symbol,
      targetPrice: input.targetPrice,
      condition: input.condition,
      isActive: true,
      cooldownMinutes: input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
      lastTriggeredAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

/** Shared repository used by the alert screens. */
export const priceAlerts = new PriceAlertRepository();
