import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAdminRole, AdminRole } from "./useAdminRole";
import { clientConfig } from "@/lib/config";

const AUTH_COOKIE = "auth-token=test-token";

function setAuthCookie(present: boolean) {
  Object.defineProperty(document, "cookie", {
    writable: true,
    value: present ? AUTH_COOKIE : "",
    configurable: true,
  });
}

type FetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<{ role?: AdminRole }>;
};

function mockFetchFactory(
  responses: FetchResponse[],
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex += 1;
    return Promise.resolve(response as any);
  });
}

describe("useAdminRole", () => {
  let originalFetch: typeof globalThis.fetch;
  const originalSessionStorage = globalThis.sessionStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalFetch = globalThis.fetch;
    // Clear session storage between tests
    try {
      sessionStorage.clear();
    } catch {
      /* noop */
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try {
      sessionStorage.clear();
    } catch {
      /* noop */
    }
  });

  describe("no auth token -> no role", () => {
    beforeEach(() => {
      setAuthCookie(false);
    });

    it("returns isAdmin=false, resolved=true, loading=false when no auth cookie is present", async () => {
      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBeNull();
      expect(result.current.resolved).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("does not call the backend when no auth cookie", async () => {
      const fetch = vi.fn();
      globalThis.fetch = fetch;

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("authorized (admin role)", () => {
    beforeEach(() => {
      setAuthCookie(true);
    });

    it("resolves isAdmin=true when backend returns role=admin", async () => {
      globalThis.fetch = mockFetchFactory([
        {
          ok: true,
          json: () => Promise.resolve({ role: "admin" as AdminRole }),
        },
      ]);

      const { result } = renderHook(() => useAdminRole());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAdmin).toBe(true);
      expect(result.current.role).toBe("admin");
      expect(result.current.resolved).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("calls /users/me with credentials include", async () => {
      const fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "admin" as AdminRole }) },
      ]);
      globalThis.fetch = fetch;

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetch).toHaveBeenCalledWith(
        `${clientConfig.apiUrl}/users/me`,
        expect.objectContaining({
          method: "GET",
          credentials: "include",
        }),
      );
    });

    it("writes resolved admin role to sessionStorage cache", async () => {
      globalThis.fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "admin" as AdminRole }) },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const cached = JSON.parse(
        sessionStorage.getItem("lumenpulse:admin-role") as string,
      );
      expect(cached.role).toBe("admin");
      expect(typeof cached.cachedAt).toBe("number");
    });

    it("subsequent renders use cached value without re-fetching", async () => {
      const fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "admin" as AdminRole }) },
      ]);
      globalThis.fetch = fetch;

      // First render: populate cache
      const first = renderHook(() => useAdminRole());
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(fetch).toHaveBeenCalledTimes(1);
      first.unmount();

      // Second render: should read from cache, no fetch
      const fetch2 = vi.fn();
      globalThis.fetch = fetch2;
      const second = renderHook(() => useAdminRole());

      await waitFor(() => expect(second.result.current.loading).toBe(false));

      expect(fetch2).not.toHaveBeenCalled();
      expect(second.result.current.isAdmin).toBe(true);
      expect(second.result.current.resolved).toBe(true);
    });

    it("refresh() forces a fresh fetch even with cache", async () => {
      const fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "admin" as AdminRole }) },
        { ok: true, json: () => Promise.resolve({ role: "admin" as AdminRole }) },
      ]);
      globalThis.fetch = fetch;

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("unauthorized (non-admin role)", () => {
    beforeEach(() => {
      setAuthCookie(true);
    });

    it("resolves isAdmin=false for role=user", async () => {
      globalThis.fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "user" as AdminRole }) },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBe("user");
      expect(result.current.resolved).toBe(true);
    });

    it("resolves isAdmin=false for role=reviewer", async () => {
      globalThis.fetch = mockFetchFactory([
        {
          ok: true,
          json: () => Promise.resolve({ role: "reviewer" as AdminRole }),
        },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBe("reviewer");
      expect(result.current.resolved).toBe(true);
    });

    it("caches non-admin role so navigation stays hidden", async () => {
      globalThis.fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "user" as AdminRole }) },
      ]);

      renderHook(() => useAdminRole());

      await waitFor(() => {
        // wait for the render cycle that writes cache
        expect(sessionStorage.getItem("lumenpulse:admin-role-resolved")).toBe("1");
      });

      const cached = JSON.parse(
        sessionStorage.getItem("lumenpulse:admin-role") as string,
      );
      expect(cached.role).toBe("user");
    });
  });

  describe("role unknown / resolution failure -> fail to deny", () => {
    beforeEach(() => {
      setAuthCookie(true);
    });

    it("backend returns HTTP 403 -> isAdmin=false and error populated (fail-to-deny)", async () => {
      globalThis.fetch = mockFetchFactory([
        {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          json: () => Promise.resolve({}),
        },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBeNull();
      expect(result.current.resolved).toBe(true);
      expect(result.current.error).toMatch(/403/);
    });

    it("backend returns unknown role string -> normalizes to null (fail-to-deny)", async () => {
      globalThis.fetch = mockFetchFactory([
        {
          ok: true,
          json: () => Promise.resolve({ role: "superuser" as AdminRole }),
        },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBeNull();
      expect(result.current.resolved).toBe(true);
    });

    it("backend returns no role field -> role=null (fail-to-deny)", async () => {
      globalThis.fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({}) },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBeNull();
      expect(result.current.resolved).toBe(true);
    });

    it("network throws -> isAdmin=false with error (fail-to-deny)", async () => {
      globalThis.fetch = vi.fn(() => Promise.reject(new Error("Network down")));

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
      expect(result.current.role).toBeNull();
      expect(result.current.resolved).toBe(true);
      expect(result.current.error).toBe("Network down");
    });

    it("after failure the cache records role=null so admin surfaces stay hidden", async () => {
      globalThis.fetch = vi.fn(() => Promise.reject(new Error("boom")));

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      const cached = JSON.parse(
        sessionStorage.getItem("lumenpulse:admin-role") as string,
      );
      expect(cached.role).toBeNull();
    });
  });

  describe("expired cache re-resolves", () => {
    beforeEach(() => {
      setAuthCookie(true);
    });

    it("ignores cache entries older than CACHE_TTL_MS and re-fetches", async () => {
      // Prime cache with a stale entry (1 hour old)
      const staleEntry = {
        role: "admin" as AdminRole,
        cachedAt: Date.now() - 60 * 60 * 1000,
      };
      sessionStorage.setItem(
        "lumenpulse:admin-role",
        JSON.stringify(staleEntry),
      );

      globalThis.fetch = mockFetchFactory([
        { ok: true, json: () => Promise.resolve({ role: "user" as AdminRole }) },
      ]);

      const { result } = renderHook(() => useAdminRole());

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Should have re-fetched and returned user (from new response), not admin (from stale cache)
      expect(result.current.role).toBe("user");
      expect(result.current.isAdmin).toBe(false);
    });
  });
});
