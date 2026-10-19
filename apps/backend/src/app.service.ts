import { Injectable } from '@nestjs/common';

export type BackgroundRefreshResource = 'watchlist' | 'portfolio';

export interface BackgroundRefreshConstraints {
  respectBattery: boolean;
  respectMeteredConnection: boolean;
  respectLowPowerMode: boolean;
}

export interface BackgroundRefreshScheduleRequest {
  userId: string;
  resources: BackgroundRefreshResource[];
  // Minimum interval in seconds. Platform limits are enforced below.
  intervalSeconds?: number;
  constraints?: Partial<BackgroundRefreshConstraints>;
  enabled?: boolean;
}

export interface BackgroundRefreshState {
  userId: string;
  resources: BackgroundRefreshResource[];
  intervalSeconds: number;
  constraints: BackgroundRefreshConstraints;
  enabled: boolean;
  lastRefreshedAt?: string;
  lastError?: string;
}

export interface BackgroundRefreshResult {
  userId: string;
  refreshed: BackgroundRefreshResource[];
  skipped: BackgroundRefreshResource[];
  refreshedAt: string;
}

const DEFAULT_INTERVAL_SECONDS = 900; // 15 minutes, within iOS and Android background limits.
const MIN_INTERVAL_SECONDS = 600; // 10 minutes floor to respect platform battery budgets.
const MAX_INTERVAL_SECONDS = 86400; // 24 hours.

const DEFAULT_CONSTRAINTS: BackgroundRefreshConstraints = {
  respectBattery: true,
  respectMeteredConnection: true,
  respectLowPowerMode: true,
};

@Injectable()
export class AppService {
  private readonly states = new Map<string, BackgroundRefreshState>();

  getHello(): string {
    return 'Hello World!';
  }

  configureBackgroundRefresh(
    request: BackgroundRefreshScheduleRequest,
  ): BackgroundRefreshState {
    const existing = this.states.get(request.userId);
    const intervalSeconds = this.clampInterval(
      request.intervalSeconds ?? existing?.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
    );
    const constraints: BackgroundRefreshConstraints = {
      respectBattery:
        request.constraints?.respectBattery ?? existing?.constraints.respectBattery ?? DEFAULT_CONSTRAINTS.respectBattery,
      respectMeteredConnection:
        request.constraints?.respectMeteredConnection ??
        existing?.constraints.respectMeteredConnection ??
        DEFAULT_CONSTRAINTS.respectMeteredConnection,
      respectLowPowerMode:
        request.constraints?.respectLowPowerMode ??
        existing?.constraints.respectLowPowerMode ??
        DEFAULT_CONSTRAINTS.respectLowPowerMode,
    };

    const state: BackgroundRefreshState = {
      userId: request.userId,
      resources: this.normalizeResources(request.resources),
      intervalSeconds,
      constraints,
      enabled: request.enabled ?? existing?.enabled ?? true,
      lastRefreshedAt: existing?.lastRefreshedAt,
      lastError: existing?.lastError,
    };

    this.states.set(request.userId, state);
    return state;
  }

  disableBackgroundRefresh(userId: string): BackgroundRefreshState | undefined {
    const existing = this.states.get(userId);
    if (!existing) {
      return undefined;
    }
    const updated: BackgroundRefreshState = { ...existing, enabled: false };
    this.states.set(userId, updated);
    return updated;
  }

  getBackgroundRefreshState(userId: string): BackgroundRefreshState | undefined {
    return this.states.get(userId);
  }

  /**
   * Runs a background refresh for the given user. The client supplies the current
   * device conditions so the server can enforce battery, metered-connection and
   * low-power constraints before fetching fresh data.
   */
  async runBackgroundRefresh(
    userId: string,
    conditions: {
      onBattery?: boolean;
      meteredConnection?: boolean;
      lowPowerMode?: boolean;
    },
    fetcher: (
      resource: BackgroundRefreshResource,
    ) => Promise<unknown>,
  ): Promise<BackgroundRefreshResult> {
    const state = this.states.get(userId);
    if (!state || !state.enabled) {
      throw new Error('Background refresh is disabled for this user');
    }

    const refreshed: BackgroundRefreshResource[] = [];
    const skipped: BackgroundRefreshResource[] = [];
    const errors: string[] = [];

    for (const resource of state.resources) {
      if (this.isBlockedByConstraints(state.constraints, conditions)) {
        skipped.push(resource);
        continue;
      }
      try {
        await fetcher(resource);
        refreshed.push(resource);
      } catch (error) {
        // Failures are silent to the user but recorded for error reporting.
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const refreshedAt = new Date().toISOString();
    const updated: BackgroundRefreshState = {
      ...state,
      lastRefreshedAt: refreshed.length > 0 ? refreshedAt : state.lastRefreshedAt,
      lastError: errors.length > 0 ? errors.join('; ') : undefined,
    };
    this.states.set(userId, updated);

    return { userId, refreshed, skipped, refreshedAt };
  }

  private clampInterval(intervalSeconds: number): number {
    if (!Number.isFinite(intervalSeconds)) {
      return DEFAULT_INTERVAL_SECONDS;
    }
    return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.floor(intervalSeconds)));
  }

  private normalizeResources(
    resources: BackgroundRefreshResource[],
  ): BackgroundRefreshResource[] {
    const allowed: BackgroundRefreshResource[] = ['watchlist', 'portfolio'];
    const unique = Array.from(new Set(resources.filter((r) => allowed.includes(r))));
    return unique.length > 0 ? unique : allowed;
  }

  private isBlockedByConstraints(
    constraints: BackgroundRefreshConstraints,
    conditions: {
      onBattery?: boolean;
      meteredConnection?: boolean;
      lowPowerMode?: boolean;
    },
  ): boolean {
    if (constraints.respectBattery && conditions.onBattery) {
      return true;
    }
    if (constraints.respectMeteredConnection && conditions.meteredConnection) {
      return true;
    }
    if (constraints.respectLowPowerMode && conditions.lowPowerMode) {
      return true;
    }
    return false;
  }
}
