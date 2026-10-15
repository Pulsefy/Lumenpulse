import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PortfolioOverviewCard from "./portfolio-overview-card";
import MarketInsightsCard from "./market-insights-card";
import type { PortfolioSummaryResponse } from "@/lib/api-services";

const noop = vi.fn();

function makeSummary(
  overrides: Partial<PortfolioSummaryResponse> = {},
): PortfolioSummaryResponse {
  return {
    totalValue: "0.00",
    currency: "USD",
    totalValueUsd: "0.00",
    assets: [],
    lastUpdated: null,
    hasLinkedAccount: false,
    exchangeRate: 1,
    ...overrides,
  };
}

describe("dashboard overview cards", () => {
  it("renders a linked-account onboarding state in the portfolio overview card", () => {
    render(
      <PortfolioOverviewCard
        publicKey="GABC123"
        summary={makeSummary({ hasLinkedAccount: false })}
        performance={null}
        allocation={null}
        isLoading={false}
        error={null}
        isFresh={null}
        lastUpdatedLabel={null}
        refresh={noop}
      />,
    );

    expect(screen.getByText(/link this wallet to your account/i)).toBeInTheDocument();
    expect(
      screen.getByText(/portfolio totals appear after the connected wallet is linked/i),
    ).toBeInTheDocument();
  });

  it("renders a stable empty-portfolio message after a zero-value snapshot", () => {
    render(
      <PortfolioOverviewCard
        publicKey="GABC123"
        summary={makeSummary({
          hasLinkedAccount: true,
          lastUpdated: "2026-07-28T11:00:00.000Z",
        })}
        performance={null}
        allocation={[]}
        isLoading={false}
        error={null}
        isFresh={true}
        lastUpdatedLabel="1h ago"
        refresh={noop}
      />,
    );

    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(
      screen.getByText(/no funded assets yet\. values will update after your first deposit/i),
    ).toBeInTheDocument();
  });

  it("renders distinct no-linked-account and first-snapshot states in the market insights card", () => {
    const { rerender } = render(
      <MarketInsightsCard
        publicKey="GABC123"
        summary={makeSummary({ hasLinkedAccount: false })}
        performance={null}
        isLoading={false}
        error={null}
        isFresh={null}
        lastUpdatedLabel={null}
        refresh={noop}
      />,
    );

    expect(screen.getByText(/link a wallet to track performance/i)).toBeInTheDocument();

    rerender(
      <MarketInsightsCard
        publicKey="GABC123"
        summary={makeSummary({
          hasLinkedAccount: true,
          lastUpdated: null,
        })}
        performance={null}
        isLoading={false}
        error={null}
        isFresh={null}
        lastUpdatedLabel={null}
        refresh={noop}
      />,
    );

    expect(screen.getByText(/waiting for your first snapshot/i)).toBeInTheDocument();
  });
});
