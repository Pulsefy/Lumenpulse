// Client for the admin feature-flag console.
//
// Mirrors apps/backend/src/feature-flags (FeatureFlagResponseDto,
// FlagAuditLogResponseDto, UpsertFeatureFlagDto):
//   GET    {API_BASE}/feature-flags                 -> FeatureFlag[]
//   GET    {API_BASE}/feature-flags/:key/history    -> FlagAuditEntry[] (admin)
//   POST   {API_BASE}/feature-flags                 -> FeatureFlag      (admin)
//
// Writes to a flag marked `sensitive` are rejected with 428 unless they carry
// `confirm: true`; that surfaces here as SensitiveConfirmationRequiredError so
// the console can open its confirmation step instead of showing a failure.

import { clientConfig } from "@/lib/config";
import { getAuthToken } from "@/lib/auth-role";

const API_BASE = clientConfig.apiUrl;

export interface FlagTargetingSnapshot {
  rolloutPercentage: number | null;
  allowList: string[];
  denyList: string[];
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  sensitive: boolean;
  rolloutPercentage: number | null;
  allowList: string[] | null;
  denyList: string[] | null;
  conditions: Record<string, unknown> | null;
  changedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlagAuditEntry {
  id: string;
  flagKey: string;
  action: "upsert" | "remove";
  previousEnabled: boolean | null;
  newEnabled: boolean | null;
  previousTargeting: Partial<FlagTargetingSnapshot> | null;
  newTargeting: Partial<FlagTargetingSnapshot> | null;
  actor: string | null;
  changedAt: string;
}

export interface FlagChange {
  enabled?: boolean;
  /** Integer 0-100, or null to return to plain on/off. Undefined leaves it. */
  rolloutPercentage?: number | null;
  sensitive?: boolean;
}

export class SensitiveConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SensitiveConfirmationRequiredError";
  }
}

/**
 * How a flag currently resolves, in operator terms.
 *
 * Follows the backend precedence in flag-targeting.ts: a non-null rollout
 * percentage fully decides the result and `enabled` is ignored, and 0% is a
 * real "serve nobody" value rather than "unset".
 */
export function describeTargeting(flag: Pick<
  FeatureFlag,
  "enabled" | "rolloutPercentage" | "allowList" | "denyList"
>): string {
  const parts: string[] = [];
  const pct = flag.rolloutPercentage;
  if (pct === null || pct === undefined) {
    parts.push(flag.enabled ? "On for everyone" : "Off for everyone");
  } else if (pct === 0) {
    parts.push("Rollout 0% (serves nobody)");
  } else if (pct === 100) {
    parts.push("Rollout 100% (everyone)");
  } else {
    parts.push(`Rollout ${pct}% of users`);
  }
  const allow = flag.allowList?.length ?? 0;
  const deny = flag.denyList?.length ?? 0;
  if (allow > 0) parts.push(`${allow} allowed`);
  if (deny > 0) parts.push(`${deny} denied`);
  return parts.join(" · ");
}

/** One-line summary of what an audit entry changed. */
export function describeAuditEntry(entry: FlagAuditEntry): string {
  if (entry.action === "remove") return "Deleted flag";
  if (entry.previousEnabled === null && entry.previousTargeting === null) {
    return `Created (${entry.newEnabled ? "on" : "off"})`;
  }

  const changes: string[] = [];
  if (entry.previousEnabled !== entry.newEnabled) {
    changes.push(
      `${entry.previousEnabled ? "on" : "off"} → ${entry.newEnabled ? "on" : "off"}`,
    );
  }
  const before = entry.previousTargeting?.rolloutPercentage ?? null;
  const after = entry.newTargeting?.rolloutPercentage ?? null;
  if (before !== after) {
    const fmt = (v: number | null) => (v === null ? "none" : `${v}%`);
    changes.push(`rollout ${fmt(before)} → ${fmt(after)}`);
  }
  return changes.length > 0 ? changes.join(", ") : "Saved with no state change";
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: authHeaders(),
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }

  if (response.ok) return response.json() as Promise<T>;

  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  if (response.status === 428) {
    throw new SensitiveConfirmationRequiredError(
      body.message ?? "This flag is sensitive and needs confirmation.",
    );
  }
  if (response.status === 401) {
    throw new Error("Your session has expired. Please log in again.");
  }
  if (response.status === 403) {
    throw new Error("Admin access is required to manage feature flags.");
  }
  throw new Error(body.message || `Request failed (${response.status})`);
}

export class FeatureFlagsApiService {
  static listFlags(): Promise<FeatureFlag[]> {
    return request<FeatureFlag[]>("/feature-flags");
  }

  static getHistory(key: string): Promise<FlagAuditEntry[]> {
    return request<FlagAuditEntry[]>(
      `/feature-flags/${encodeURIComponent(key)}/history`,
    );
  }

  /**
   * Applies a change to an existing flag.
   *
   * The backend upsert replaces `conditions` on every write and replaces both
   * allow/deny lists whenever any targeting field is sent, so the current
   * values are always echoed back. Without that, nudging a rollout from the
   * console would silently wipe the flag's allow and deny lists.
   */
  static updateFlag(
    flag: FeatureFlag,
    change: FlagChange,
    options: { confirm?: boolean } = {},
  ): Promise<FeatureFlag> {
    const body: Record<string, unknown> = {
      key: flag.key,
      enabled: change.enabled ?? flag.enabled,
    };
    if (flag.conditions) body.conditions = flag.conditions;
    if (change.rolloutPercentage !== undefined) {
      body.rolloutPercentage = change.rolloutPercentage;
      body.allowList = flag.allowList ?? [];
      body.denyList = flag.denyList ?? [];
    }
    if (change.sensitive !== undefined) body.sensitive = change.sensitive;
    if (options.confirm) body.confirm = true;

    return request<FeatureFlag>("/feature-flags", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
