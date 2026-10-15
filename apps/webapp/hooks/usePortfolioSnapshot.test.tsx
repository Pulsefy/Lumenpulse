import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePortfolioSnapshot } from "./usePortfolioSnapshot";
import { PortfolioApiService } from "@/lib/api-services";

describe("usePortfolioSnapshot", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-07-28T12:00:00.000Z").getTime(),
    );
    vi.spyOn(PortfolioApiService, "isAuthenticated").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps summary and performance data when allocation fetch fails", async () => {
    vi.spyOn(PortfolioApiService, "getSummary").mockResolvedValue({
      totalValue: "1250.50",
      currency: "USD",
      totalValueUsd: "1250.50",
      assets: [],
      lastUpdated: "2026-07-28T11:35:00.000Z",
      hasLinkedAccount: true,
      exchangeRate: 1,
    });
    vi.spyOn(PortfolioApiService, "getPerformance").mockResolvedValue({
      userId: "user-1",
      currentValueUsd: 1250.5,
      calculatedAt: "2026-07-28T11:35:00.000Z",
      windows: [
        {
          window: "24h",
          hasData: true,
          absolutePnl: 50,
          percentageChange: 4.17,
          currentValueUsd: 1250.5,
          baselineValueUsd: 1200.5,
          baselineDate: "2026-07-27T11:35:00.000Z",
        },
        {
          window: "7d",
          hasData: false,
          absolutePnl: null,
          percentageChange: null,
          currentValueUsd: 1250.5,
          baselineValueUsd: null,
          baselineDate: null,
        },
        {
          window: "30d",
          hasData: false,
          absolutePnl: null,
          percentageChange: null,
          currentValueUsd: 1250.5,
          baselineValueUsd: null,
          baselineDate: null,
        },
      ],
    });
    vi.spyOn(PortfolioApiService, "getAllocation").mockRejectedValue(
      new Error("allocation unavailable"),
    );

    const { result } = renderHook(() =>
      usePortfolioSnapshot("GBRPYHIL2C6Q2XQY5W4O6OQK5C6G3XQ2M3NQ5H1R8S9T0U1V2W3X4Y5Z"),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.summary?.totalValueUsd).toBe("1250.50");
    expect(result.current.performance?.currentValueUsd).toBe(1250.5);
    expect(result.current.allocation).toBeNull();
    expect(result.current.summaryError).toBeNull();
    expect(result.current.performanceError).toBeNull();
    expect(result.current.isFresh).toBe(true);
    expect(result.current.lastUpdatedLabel).toBe("25 min ago");
  });

  it("surfaces a performance-specific error without discarding summary data", async () => {
    vi.spyOn(PortfolioApiService, "getSummary").mockResolvedValue({
      totalValue: "0.00",
      currency: "USD",
      totalValueUsd: "0.00",
      assets: [],
      lastUpdated: "2026-07-28T10:00:00.000Z",
      hasLinkedAccount: true,
      exchangeRate: 1,
    });
    vi.spyOn(PortfolioApiService, "getPerformance").mockRejectedValue(
      new Error("performance unavailable"),
    );
    vi.spyOn(PortfolioApiService, "getAllocation").mockResolvedValue([]);

    const { result } = renderHook(() =>
      usePortfolioSnapshot("GBRPYHIL2C6Q2XQY5W4O6OQK5C6G3XQ2M3NQ5H1R8S9T0U1V2W3X4Y5Z"),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.summary?.totalValueUsd).toBe("0.00");
    expect(result.current.performance).toBeNull();
    expect(result.current.summaryError).toBeNull();
    expect(result.current.performanceError).toBe("performance unavailable");
  });
});
