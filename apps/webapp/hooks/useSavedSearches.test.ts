import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSavedSearches } from "./useSavedSearches";
import { SavedSearchesApiService } from "@/lib/search-api";
import type { SavedSearch } from "@/lib/search-api";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeSavedSearch(
  overrides: Partial<SavedSearch> = {},
): SavedSearch {
  return {
    id: "search-1",
    userId: "user-1",
    name: "Verified projects",
    query: "Lumen",
    filters: { kind: "project", status: "VERIFIED" },
    notificationsEnabled: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Make document.cookie look like an authenticated session. */
function fakeAuthCookie() {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "auth-token=fake-token",
  });
}

/** Clear the fake cookie. */
function clearAuthCookie() {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSavedSearches", () => {
  beforeEach(() => {
    fakeAuthCookie();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAuthCookie();
  });

  // ─── Initial fetch ────────────────────────────────────────────────────────

  it("fetches saved searches on mount and populates items", async () => {
    const fixture = makeSavedSearch();
    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [fixture],
      total: 1,
    });

    const { result } = renderHook(() => useSavedSearches());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].name).toBe("Verified projects");
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error when the list fetch fails", async () => {
    vi.spyOn(SavedSearchesApiService, "list").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(() => useSavedSearches());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBe("Network error");
  });

  it("skips the fetch when no auth cookie is present", async () => {
    clearAuthCookie();
    const spy = vi.spyOn(SavedSearchesApiService, "list");

    const { result } = renderHook(() => useSavedSearches());

    // Should settle immediately to isLoading=false without calling the API.
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
  });

  // ─── Create ───────────────────────────────────────────────────────────────

  it("prepends the new search after create", async () => {
    const existing = makeSavedSearch({ id: "search-old", name: "Old search" });
    const created = makeSavedSearch({ id: "search-new", name: "New search" });

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [existing],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "create").mockResolvedValue(created);

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createSearch({ name: "New search", query: "new" });
    });

    expect(result.current.items[0].id).toBe("search-new");
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(2);
  });

  it("surfaces a create error and does not change state", async () => {
    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SavedSearchesApiService, "create").mockRejectedValue(
      new Error("Name already exists"),
    );

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      try {
        await result.current.createSearch({ name: "Duplicate" });
      } catch {
        // expected
      }
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBe("Name already exists");
  });

  // ─── Update ───────────────────────────────────────────────────────────────

  it("patches the item in place after update", async () => {
    const original = makeSavedSearch();
    const renamed = { ...original, name: "Renamed" };

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [original],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "update").mockResolvedValue(renamed);

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSearch("search-1", { name: "Renamed" });
    });

    expect(result.current.items[0].name).toBe("Renamed");
    expect(result.current.items).toHaveLength(1);
  });

  // ─── Delete ───────────────────────────────────────────────────────────────

  it("removes the item optimistically and keeps it gone after delete", async () => {
    const fixture = makeSavedSearch();

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [fixture],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "remove").mockResolvedValue(undefined);

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteSearch("search-1");
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  it("restores the list when delete fails", async () => {
    const fixture = makeSavedSearch();

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [fixture],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "remove").mockRejectedValue(
      new Error("Delete failed"),
    );

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      try {
        await result.current.deleteSearch("search-1");
      } catch {
        // expected
      }
    });

    // Item should be restored after the rollback.
    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBe("Delete failed");
  });

  // ─── Notification toggle ──────────────────────────────────────────────────

  it("optimistically toggles notifications and confirms with the server response", async () => {
    const fixture = makeSavedSearch({ notificationsEnabled: false });
    const toggled = { ...fixture, notificationsEnabled: true };

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [fixture],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "setNotifications").mockResolvedValue(
      toggled,
    );

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Optimistic update is applied during the async tick, so we read inside act.
    await act(async () => {
      await result.current.toggleNotifications("search-1", true);
    });

    expect(result.current.items[0].notificationsEnabled).toBe(true);
  });

  it("rolls back the notification flag when the server call fails", async () => {
    const fixture = makeSavedSearch({ notificationsEnabled: false });

    vi.spyOn(SavedSearchesApiService, "list").mockResolvedValue({
      items: [fixture],
      total: 1,
    });
    vi.spyOn(SavedSearchesApiService, "setNotifications").mockRejectedValue(
      new Error("Server error"),
    );

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      try {
        await result.current.toggleNotifications("search-1", true);
      } catch {
        // expected
      }
    });

    // Flag should be rolled back to its original value.
    expect(result.current.items[0].notificationsEnabled).toBe(false);
    expect(result.current.error).toBe("Server error");
  });

  // ─── Refresh ──────────────────────────────────────────────────────────────

  it("re-fetches the list when refresh is called", async () => {
    const first = makeSavedSearch({ name: "First" });
    const second = makeSavedSearch({ id: "search-2", name: "Second" });

    const spy = vi
      .spyOn(SavedSearchesApiService, "list")
      .mockResolvedValueOnce({ items: [first], total: 1 })
      .mockResolvedValueOnce({ items: [first, second], total: 2 });

    const { result } = renderHook(() => useSavedSearches());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
