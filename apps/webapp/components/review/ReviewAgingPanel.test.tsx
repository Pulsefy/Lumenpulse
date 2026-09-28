import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReviewAgingPanel, bucketQueueHref } from "./ReviewAgingPanel";
import type { ReviewMetricsResponse } from "@/lib/review-metrics-service";

const BUCKETS = [
  { label: "< 1 hour", minHours: 0, maxHours: 1 },
  { label: "1–6 hours", minHours: 1, maxHours: 6 },
  { label: "6–24 hours", minHours: 6, maxHours: 24 },
  { label: "1–3 days", minHours: 24, maxHours: 72 },
  { label: "3–7 days", minHours: 72, maxHours: 168 },
  { label: "> 7 days", minHours: 168, maxHours: null },
];

function response(counts: number[], anomalyCounts: number[] = counts.map(() => 0)): ReviewMetricsResponse {
  const total = counts.reduce((a, b) => a + b, 0) + anomalyCounts.reduce((a, b) => a + b, 0);
  return {
    computedAt: new Date().toISOString(),
    grandTotalOpen: total,
    domains: [
      {
        domain: "moderation",
        totalOpen: counts.reduce((a, b) => a + b, 0),
        averageAgeMs: 0,
        medianAgeMs: null,
        oldestAgeMs: 9 * 24 * 3_600_000,
        newestAgeMs: null,
        buckets: BUCKETS.map((b, i) => ({ ...b, count: counts[i] })),
      },
      {
        domain: "anomaly",
        totalOpen: anomalyCounts.reduce((a, b) => a + b, 0),
        averageAgeMs: 0,
        medianAgeMs: null,
        oldestAgeMs: null,
        newestAgeMs: null,
        buckets: BUCKETS.map((b, i) => ({ ...b, count: anomalyCounts[i] })),
      },
    ],
  };
}

function mockFetch(impl: () => Promise<Partial<Response>>) {
  global.fetch = vi.fn(impl) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewAgingPanel", () => {
  it("renders nothing for non-reviewer roles and does not call the endpoint", () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => response([1, 0, 0, 0, 0, 0]) }));
    const { container: asUser } = render(<ReviewAgingPanel role="user" />);
    const { container: anon } = render(<ReviewAgingPanel role={null} />);
    expect(asUser.innerHTML).toBe("");
    expect(anon.innerHTML).toBe("");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["reviewer", "admin"] as const)("shows combined buckets for %s", async (role) => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => response([2, 0, 0, 0, 1, 3], [1, 0, 0, 0, 0, 0]),
    }));
    render(<ReviewAgingPanel role={role} thresholdHours={72} />);

    const under1h = await screen.findByLabelText("3 pending < 1 hour");
    expect(under1h.getAttribute("data-overdue")).toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("flags buckets at or past the threshold", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => response([2, 0, 0, 4, 1, 3]) }));
    render(<ReviewAgingPanel role="admin" thresholdHours={72} />);

    const threeToSeven = await screen.findByLabelText("1 pending 3–7 days, past threshold");
    expect(threeToSeven.getAttribute("data-overdue")).toBe("true");
    expect(screen.getByLabelText("3 pending > 7 days, past threshold")).toBeTruthy();
    expect(screen.getByLabelText("4 pending 1–3 days").getAttribute("data-overdue")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("4 past threshold");
  });

  it("links bucket counts to the filtered queue", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => response([1, 0, 0, 0, 0, 2]) }));
    render(<ReviewAgingPanel role="reviewer" />);

    const link = await screen.findByLabelText(/2 pending > 7 days/);
    expect(link.getAttribute("href")).toBe("/review?status=IN_REVIEW&minAgeHours=168");
    expect(bucketQueueHref({ label: "x", minHours: 1, maxHours: 6, count: 0 })).toBe(
      "/review?status=IN_REVIEW&minAgeHours=1&maxAgeHours=6",
    );
  });

  it("shows an empty state when the endpoint returns no data", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    render(<ReviewAgingPanel role="admin" />);
    expect(await screen.findByText("No pending items are waiting for review.")).toBeTruthy();
  });

  it("shows an empty state when every bucket is zero", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => response([0, 0, 0, 0, 0, 0]) }));
    render(<ReviewAgingPanel role="admin" />);
    expect(await screen.findByText("No pending items are waiting for review.")).toBeTruthy();
  });

  it("degrades gracefully when the endpoint fails", async () => {
    mockFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    render(<ReviewAgingPanel role="admin" />);
    await waitFor(() =>
      expect(screen.getByText(/Aging metrics are unavailable right now/)).toBeTruthy(),
    );
  });
});
