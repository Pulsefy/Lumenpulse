import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SignalsPanel from "./signals-panel";
import type { UserSignalsResponse } from "@/lib/signals-service";

const noop = vi.fn();

const mockSignalsData: UserSignalsResponse = {
  userId: "user-1",
  generatedAt: "2026-07-28T11:30:00.000Z",
  signals: [
    {
      category: "holdings",
      severity: "medium",
      title: "Single-asset concentration",
      detail: "The portfolio holds only BTC, which may increase exposure to a single asset.",
    },
    {
      category: "activity",
      severity: "low",
      title: "Normal recent activity",
      detail: "Recent transactions are available and do not indicate unusual risk behavior.",
    },
  ],
};

describe("SignalsPanel", () => {
  it("renders a not-authenticated prompt when user is not signed in", () => {
    render(
      <SignalsPanel
        data={null}
        isLoading={false}
        error={null}
        isFresh={null}
        ageLabel={null}
        refresh={noop}
        isAuthenticated={false}
      />,
    );

    expect(screen.getByText(/sign in to view market signals/i)).toBeInTheDocument();
  });

  it("renders a loading skeleton while fetching", () => {
    const { container } = render(
      <SignalsPanel
        data={null}
        isLoading={true}
        error={null}
        isFresh={null}
        ageLabel={null}
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders the error state with a retry button", () => {
    render(
      <SignalsPanel
        data={null}
        isLoading={false}
        error="Failed to load signals"
        isFresh={null}
        ageLabel={null}
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/failed to load signals/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders the empty state when no signals are returned", () => {
    render(
      <SignalsPanel
        data={{ userId: "user-1", generatedAt: "2026-07-28T11:30:00.000Z", signals: [] }}
        isLoading={false}
        error={null}
        isFresh={true}
        ageLabel="30 min ago"
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    expect(screen.getByText(/no signals available/i)).toBeInTheDocument();
  });

  it("renders signal titles, categories, and severity", () => {
    render(
      <SignalsPanel
        data={mockSignalsData}
        isLoading={false}
        error={null}
        isFresh={true}
        ageLabel="30 min ago"
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    expect(screen.getByText("Single-asset concentration")).toBeInTheDocument();
    expect(screen.getByText("Normal recent activity")).toBeInTheDocument();
    expect(screen.getByText("Holdings")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getAllByText(/strength:/i).length).toBeGreaterThan(0);
  });

  it("labels stale data with its age", () => {
    render(
      <SignalsPanel
        data={mockSignalsData}
        isLoading={false}
        error={null}
        isFresh={false}
        ageLabel="2d ago"
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    expect(screen.getByText(/stale — 2d ago/i)).toBeInTheDocument();
  });

  it("renders a refresh button that calls refresh on click", () => {
    render(
      <SignalsPanel
        data={mockSignalsData}
        isLoading={false}
        error={null}
        isFresh={true}
        ageLabel="30 min ago"
        refresh={noop}
        isAuthenticated={true}
      />,
    );

    const refreshBtn = screen.getByRole("button", { name: /refresh signals/i });
    fireEvent.click(refreshBtn);
    expect(noop).toHaveBeenCalledTimes(1);
  });
});
