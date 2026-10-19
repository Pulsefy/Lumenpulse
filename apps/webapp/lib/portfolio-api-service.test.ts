import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  clientConfig: { apiUrl: "https://api.example.test" },
}));

import { PortfolioApiService } from "./api-services";

describe("PortfolioApiService anomaly endpoints", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the current user's anomalies from the existing endpoint", async () => {
    const result = { anomalies: [], total: 0 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(PortfolioApiService.getAnomalies("user 1")).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/portfolio/anomalies?userId=user%201",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("posts the selected review state to the existing review endpoint", async () => {
    const result = { id: "anomaly/1", status: "acknowledged" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      PortfolioApiService.reviewAnomaly("anomaly/1", "acknowledged"),
    ).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/portfolio/anomalies/anomaly%2F1/review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ status: "acknowledged" }),
      }),
    );
  });

  it("surfaces review endpoint errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      PortfolioApiService.reviewAnomaly("anomaly-1", "acknowledged"),
    ).rejects.toThrow("Forbidden");
  });
});

describe("PortfolioApiService allocation endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the backend allocation response envelope", async () => {
    const result = {
      totalValueUsd: 1250,
      allocation: [
        {
          assetCode: "XLM",
          assetIssuer: null,
          amount: "1250",
          valueUsd: 1250,
          percentage: 100,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(PortfolioApiService.getAllocation()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/portfolio/allocation",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });
});
