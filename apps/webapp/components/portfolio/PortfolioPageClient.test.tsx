import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PortfolioPageClient from "./PortfolioPageClient";

const mocks = vi.hoisted(() => ({
  getAnomalies: vi.fn(),
  reviewAnomaly: vi.fn(),
  refresh: vi.fn(),
  role: "reviewer" as "reviewer" | "admin" | "user" | null,
  publicKey: "GABCDEF123456789",
  portfolio: {
    summary: {
      totalValue: "100.00",
      currency: "USD",
      totalValueUsd: "100.00",
      assets: [
        {
          assetCode: "XLM",
          assetIssuer: null,
          amount: "100",
          value: 100,
          valueUsd: 100,
        },
      ],
      lastUpdated: "2026-10-16T12:00:00.000Z",
      hasLinkedAccount: true,
      exchangeRate: 1,
    },
    performance: {
      userId: "user-1",
      currentValueUsd: 100,
      calculatedAt: "2026-10-16T12:00:00.000Z",
      windows: [
        {
          window: "24h",
          hasData: true,
          absolutePnl: 5,
          percentageChange: 5,
          currentValueUsd: 100,
          baselineValueUsd: 95,
          baselineDate: "2026-10-15T12:00:00.000Z",
        },
      ],
    },
    allocation: [
      {
        assetCode: "XLM",
        assetIssuer: null,
        amount: "100",
        valueUsd: 100,
        percentage: 100,
      },
    ],
    isLoading: false,
    summaryError: null,
    performanceError: null,
    allocationError: null,
    isFresh: true,
    lastUpdatedLabel: "just now",
  },
}));

vi.mock("@/app/providers", () => ({
  useStellarWallet: () => ({ publicKey: mocks.publicKey }),
}));

vi.mock("@/hooks/usePortfolioSnapshot", () => ({
  usePortfolioSnapshot: () => ({ ...mocks.portfolio, refresh: mocks.refresh }),
}));

vi.mock("@/lib/auth-role", () => ({
  getCurrentUserId: () => "user-1",
  getCurrentUserRole: () => mocks.role,
  REVIEW_ROLES: ["reviewer", "admin"],
}));

vi.mock("@/lib/api-services", () => ({
  PortfolioApiService: {
    isAuthenticated: () => true,
    getAnomalies: mocks.getAnomalies,
    reviewAnomaly: mocks.reviewAnomaly,
  },
}));

const anomaly = {
  id: "anomaly-1",
  userId: "user-1",
  title: "Unusual balance change",
  description: "Balance increased by an unexpected amount.",
  anomalyType: "balance_change",
  severity: "high",
  status: "unresolved",
  reviewerId: null,
  reviewerNotes: null,
  reviewedAt: null,
  reviewerNotesUpdatedAt: null,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  version: 1,
};

describe("PortfolioPageClient", () => {
  beforeEach(() => {
    mocks.getAnomalies.mockReset().mockResolvedValue({ anomalies: [anomaly], total: 1 });
    mocks.reviewAnomaly.mockReset().mockResolvedValue({
      ...anomaly,
      status: "acknowledged",
    });
    mocks.refresh.mockReset();
    mocks.role = "reviewer";
    mocks.publicKey = "GABCDEF123456789";
    mocks.portfolio = {
      ...mocks.portfolio,
      summary: {
        ...mocks.portfolio.summary,
        assets: [...mocks.portfolio.summary.assets],
      },
    };
  });

  it("shows labeled allocation, performance, and anomaly reasons", async () => {
    render(<PortfolioPageClient />);

    expect(await screen.findByText(/balance increased by an unexpected amount/i)).toBeInTheDocument();
    expect(screen.getByText(/XLM 100.0%/)).toBeInTheDocument();
    expect(screen.getAllByText("+$5.00")).toHaveLength(2);
  });

  it("submits an acknowledgement and updates the row without reloading", async () => {
    render(<PortfolioPageClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Acknowledge" }, { timeout: 5000 }),
    );

    await waitFor(() => {
      expect(mocks.reviewAnomaly).toHaveBeenCalledWith("anomaly-1", "acknowledged");
      expect(screen.getByText("Acknowledged")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    });
    expect(mocks.getAnomalies).toHaveBeenCalledTimes(1);
  });

  it("keeps the anomaly unresolved and surfaces a failed review", async () => {
    mocks.reviewAnomaly.mockRejectedValueOnce(new Error("Review failed"));
    render(<PortfolioPageClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Review failed");
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
  });

  it("shows an anomaly load error and allows retrying", async () => {
    mocks.getAnomalies.mockRejectedValueOnce(new Error("Anomaly service unavailable"));
    render(<PortfolioPageClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Anomaly service unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Unusual balance change")).toBeInTheDocument();
    expect(mocks.getAnomalies).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state when the anomaly endpoint returns no records", async () => {
    mocks.getAnomalies.mockResolvedValueOnce({ anomalies: [], total: 0 });
    render(<PortfolioPageClient />);

    expect(
      await screen.findByText(/no portfolio anomalies have been flagged/i),
    ).toBeInTheDocument();
  });

  it("explains an empty portfolio without rendering zero-value portfolio cards", async () => {
    mocks.portfolio = {
      ...mocks.portfolio,
      summary: {
        ...mocks.portfolio.summary,
        totalValue: "0.00",
        totalValueUsd: "0.00",
        assets: [],
        lastUpdated: "",
        hasLinkedAccount: false,
      },
      allocation: [],
    };
    render(<PortfolioPageClient />);

    expect(await screen.findByText("No portfolio data yet")).toBeInTheDocument();
    expect(screen.queryByText("Total Value")).not.toBeInTheDocument();
  });

  it("does not request restricted anomaly data for regular users", async () => {
    mocks.role = "user";
    render(<PortfolioPageClient />);

    expect(
      await screen.findByText(/available to portfolio reviewers and administrators/i),
    ).toBeInTheDocument();
    expect(mocks.getAnomalies).not.toHaveBeenCalled();
  });
});
