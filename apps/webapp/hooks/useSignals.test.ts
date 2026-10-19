import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSignals } from "./useSignals";
import { SignalsApiService } from "@/lib/signals-service";

const mockSignalsResponse = {
  userId: "user-1",
  generatedAt: "2026-07-28T11:30:00.000Z",
  signals: [
    {
      category: "holdings" as const,
      severity: "medium" as const,
      title: "Single-asset concentration",
      detail: "The portfolio holds only BTC, which may increase exposure to a single asset.",
    },
    {
      category: "activity" as const,
      severity: "low" as const,
      title: "No activity in the last 30 days",
      detail: "The account has been quiet for more than 30 days.",
    },
  ],
};

describe("useSignals", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-07-28T12:00:00.000Z").getTime(),
    );
    vi.spyOn(SignalsApiService, "isAuthenticated").mockReturnValue(true);
    vi.spyOn(SignalsApiService, "getLatestSignals").mockResolvedValue(mockSignalsResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns authenticated=false and no data when not authenticated", () => {
    vi.spyOn(SignalsApiService, "isAuthenticated").mockReturnValue(false);

    const { result } = renderHook(() => useSignals());

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches signals and exposes staleness and age label", async () => {
    const { result } = renderHook(() => useSignals());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockSignalsResponse);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isFresh).toBe(true);
    expect(result.current.ageLabel).toBe("30 min ago");
  });

  it("surfaces fetch errors without crashing", async () => {
    vi.spyOn(SignalsApiService, "getLatestSignals").mockRejectedValue(
      new Error("signals unavailable"),
    );

    const { result } = renderHook(() => useSignals());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("signals unavailable");
    expect(result.current.data).toBeNull();
  });

  it("refresh triggers a re-fetch", async () => {
    const { result } = renderHook(() => useSignals());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(SignalsApiService.getLatestSignals).toHaveBeenCalledTimes(1);

    result.current.refresh();

    await waitFor(() => {
      expect(SignalsApiService.getLatestSignals).toHaveBeenCalledTimes(2);
    });

    expect(result.current.data).toEqual(mockSignalsResponse);
  });
});
