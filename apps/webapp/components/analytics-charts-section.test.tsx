import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalyticsChartsSection from "./analytics-charts-section";
import { clearAnalyticsCache } from "@/lib/analytics-service";
import type { ChartDataPoint, ChartMeta } from "@/lib/analytics-service";

// Labels deliberately differ from anything hard-coded in the component.
const meta: ChartMeta = {
  xAxis: { id: "timestamp", label: "Bucket start" },
  yAxes: [
    { id: "sentiment", label: "Mean score" },
    { id: "count", label: "Items" },
  ],
  series: [
    { key: "sentiment", label: "Mood index", axisId: "sentiment" },
    { key: "count", label: "Volume of signals", axisId: "count" },
  ],
  ranges: [
    { range: "7d", label: "One week", interval: "1h" },
    { range: "30d", label: "One month", interval: "1d" },
  ],
};

function points(n: number): ChartDataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    sentiment: 0.25,
    count: 10 + i,
  }));
}

function mockApi(data: Record<string, ChartDataPoint[]>) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes("/analytics/chart-meta")
      ? meta
      : data[new URL(url).searchParams.get("range") ?? ""];
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const dataCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/analytics/chart-data"));

describe("AnalyticsChartsSection", () => {
  beforeEach(() => clearAnalyticsCache());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders range options and series titles from the API", async () => {
    mockApi({ "7d": points(10) });
    render(<AnalyticsChartsSection />);

    const group = await screen.findByRole("group", { name: /time range/i });
    expect(within(group).getByRole("button", { name: "One week" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "One month" })).toHaveAttribute("aria-pressed", "false");

    expect(await screen.findByText("Mood index")).toBeInTheDocument();
    expect(screen.getByText("Volume of signals")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /Mood index, Mean score over Bucket start/ })).toBeInTheDocument();
  });

  it("falls back to a table when data is sparse", async () => {
    mockApi({ "7d": points(2) });
    render(<AnalyticsChartsSection />);

    const table = await screen.findByRole("table");
    expect(screen.getByText(/too few data points/i)).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Bucket start" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Mood index" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("can show dense data as a table on request", async () => {
    mockApi({ "7d": points(10) });
    render(<AnalyticsChartsSection />);

    await userEvent.click(await screen.findByRole("button", { name: /show table/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(11);
  });

  it("serves a previously viewed range from cache without refetching", async () => {
    const fetchMock = mockApi({ "7d": points(10), "30d": points(30) });
    render(<AnalyticsChartsSection />);
    await screen.findByText("Mood index");

    await userEvent.click(screen.getByRole("button", { name: "One month" }));
    await waitFor(() => expect(dataCalls(fetchMock)).toHaveLength(2));
    expect(String(dataCalls(fetchMock)[1][0])).toContain("interval=1d");

    await userEvent.click(screen.getByRole("button", { name: "One week" }));
    await screen.findByText("Mood index");
    expect(dataCalls(fetchMock)).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/analytics/chart-meta")),
    ).toHaveLength(1);
  });

  it("shows an error when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}) }) as Response),
    );
    render(<AnalyticsChartsSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/chart metadata/i);
  });
});
