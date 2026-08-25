import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useDependencyHealth,
  DEPENDENCY_STATE_LABELS,
} from "./useDependencyHealth";

void act;

// ── Helpers ──────────────────────────────────────────────────────────────

function makeResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeHealthyReport() {
  return {
    overallState: "ok",
    checkedAt: "2024-01-01T00:00:00.000Z",
    dependencies: [
      { name: "horizon", latencyMs: 120, state: "ok" },
      { name: "sorobanRpc", latencyMs: 230, state: "ok" },
    ],
  };
}

function makeDegradedReport() {
  return {
    overallState: "degraded",
    checkedAt: "2024-01-01T00:00:00.000Z",
    dependencies: [
      { name: "horizon", latencyMs: 2500, state: "degraded" },
      { name: "sorobanRpc", latencyMs: 800, state: "ok" },
    ],
  };
}

function makeHardDownReport() {
  return {
    overallState: "hard_down",
    checkedAt: "2024-01-01T00:00:00.000Z",
    dependencies: [
      {
        name: "horizon",
        latencyMs: 6000,
        state: "hard_down",
        message: "Latency 6000ms exceeds hard-down threshold",
      },
      { name: "sorobanRpc", latencyMs: 100, state: "ok" },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}



// ── Suite ─────────────────────────────────────────────────────────────────

describe("useDependencyHealth", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the empty report and isLoading=true before the first fetch resolves", async () => {
    const pending = deferred<Response>();
    globalThis.fetch = vi.fn(() => pending.promise) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.horizon.state).toBe("unknown");
    expect(result.current.sorobanRpc.state).toBe("unknown");
    expect(result.current.overallState).toBe("unavailable");

    await act(async () => {
      pending.resolve(makeResponse(makeHealthyReport()));
      await pending.promise;
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("parses a healthy response and derives overallState=ok", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(makeResponse(makeHealthyReport())),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.overallState).toBe("ok");
    expect(result.current.horizon).toMatchObject({
      state: "ok",
      latencyMs: 120,
    });
    expect(result.current.sorobanRpc).toMatchObject({
      state: "ok",
      latencyMs: 230,
    });
    expect(result.current.isUnavailable).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastFetchedAt).not.toBeNull();
  });

  it("classifies degraded state per-dependency", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(makeResponse(makeDegradedReport())),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.overallState).toBe("degraded");
    expect(result.current.horizon.state).toBe("degraded");
    expect(result.current.sorobanRpc.state).toBe("ok");
  });

  it("captures hard_down state and the underlying message", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(makeResponse(makeHardDownReport(), { status: 503 })),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.overallState).toBe("hard_down");
    expect(result.current.horizon.state).toBe("hard_down");
    expect(result.current.horizon.message).toContain("hard-down");
    // 5xx is *payload*, not an error — isUnavailable must stay false.
    expect(result.current.isUnavailable).toBe(false);
  });

  it("marks the hook as unavailable when fetch throws", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isUnavailable).toBe(true);
    expect(result.current.error).toBe("network down");
    expect(result.current.overallState).toBe("unavailable");
  });

  it("retry() triggers a new fetch", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve(makeResponse(makeHealthyReport()));
    }) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const before = calls;
    act(() => {
      result.current.retry();
    });

    // Let the new effect's effect-run finish — retry() cancels the
    // in-flight fetch and `useEffect` schedules a re-run after the next
    // React render commits.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(calls).toBeGreaterThan(before);
    });
  });

  it("surfaces non-200 (4xx) responses as errors with the available payload", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(makeResponse({ message: "nope" }, { status: 404 })),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isUnavailable).toBe(true);
    expect(result.current.error).toMatch(/404/);
  });

  it("ceases polling once the hook is unmounted", async () => {
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve(makeResponse(makeHealthyReport()));
    }) as typeof fetch;

    const { unmount } = renderHook(() =>
      useDependencyHealth({ pollIntervalMs: 100, poll: true }),
    );

    // Let the initial fetch resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsAfterMount = calls;

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(calls).toBe(callsAfterMount);
  });

  it("exposes stable display labels for every state", () => {
    expect(DEPENDENCY_STATE_LABELS.ok).toBe("operational");
    expect(DEPENDENCY_STATE_LABELS.degraded).toBe("slow");
    expect(DEPENDENCY_STATE_LABELS.hard_down).toBe("down");
    expect(DEPENDENCY_STATE_LABELS.unknown).toBe("checking");
    expect(DEPENDENCY_STATE_LABELS.unavailable).toBe("unavailable");
  });
});

// Reserved for future slow-fetch / reject scenarios; intentionally not used.
type FetchMockOptions = {
  delayMs?: number;
  rejectWith?: Error;
};
void (null as FetchMockOptions | null);

describe("useDependencyHealth – malformed payloads", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("falls back to unknown states when dependencies array is missing", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        makeResponse({ overallState: "ok", checkedAt: "x" }),
      ),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.overallState).toBe("ok");
    expect(result.current.horizon.state).toBe("unknown");
    expect(result.current.sorobanRpc.state).toBe("unknown");
  });

  it("ignores unknown dependency names instead of leaking them into the UI", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        makeResponse({
          overallState: "ok",
          checkedAt: "x",
          dependencies: [
            { name: "horizon", state: "ok", latencyMs: 100 },
            { name: "someOtherService", state: "ok", latencyMs: 100 },
          ],
        }),
      ),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.horizon.state).toBe("ok");
    expect(result.current.sorobanRpc.state).toBe("unknown");
  });

  it("drops latency values that are not finite numbers", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        makeResponse({
          overallState: "ok",
          checkedAt: "x",
          dependencies: [
            { name: "horizon", state: "ok", latencyMs: Number.NaN },
            { name: "sorobanRpc", state: "ok", latencyMs: 100 },
          ],
        }),
      ),
    ) as typeof fetch;

    const { result } = renderHook(() => useDependencyHealth({ poll: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.horizon.latencyMs).toBeUndefined();
    expect(result.current.sorobanRpc.latencyMs).toBe(100);
  });
});
