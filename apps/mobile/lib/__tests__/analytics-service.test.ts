import { apiClient } from '../api-client';
import {
  chartDataQuery,
  fetchChartData,
  fetchChartMeta,
  portfolioChartLoader,
} from '../analytics-service';
import type { ChartDataPoint, ChartMeta, ChartRangeOption } from '../analytics';

jest.mock('../api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const get = apiClient.get as jest.Mock;

const META: ChartMeta = {
  xAxis: { id: 'timestamp', label: 'Time' },
  yAxes: [
    { id: 'sentiment', label: 'Sentiment' },
    { id: 'volume', label: 'Mentions' },
  ],
  series: [
    { key: 'sentiment', label: 'Sentiment', axisId: 'sentiment' },
    { key: 'count', label: 'Mentions', axisId: 'volume' },
  ],
  ranges: [
    { range: '7d', label: '7 days', interval: '1h' },
    { range: '30d', label: '30 days', interval: '1d' },
  ],
};

const POINTS: ChartDataPoint[] = [{ timestamp: '2026-01-01T00:00:00.000Z', sentiment: 1, count: 2 }];

const ok = <T,>(data: T) => ({ success: true, data });
const fail = (message?: string) => ({ success: false, error: message ? { message } : undefined });

afterEach(() => {
  jest.clearAllMocks();
  portfolioChartLoader.invalidate();
});

describe('chartDataQuery', () => {
  it('encodes the range and the interval the backend expects', () => {
    expect(chartDataQuery({ range: '30d', label: '30 days', interval: '1d' })).toBe(
      'range=30d&interval=1d',
    );
  });

  it('adds the asset filter only when one is given', () => {
    expect(chartDataQuery({ range: '7d', label: '7 days', interval: '1h' }, 'XLM')).toBe(
      'range=7d&interval=1h&asset=XLM',
    );
    expect(chartDataQuery({ range: '7d', label: '7 days', interval: '1h' }, '')).toBe(
      'range=7d&interval=1h',
    );
  });
});

describe('fetchChartMeta', () => {
  it('requests the descriptor endpoint and unwraps the payload', async () => {
    get.mockResolvedValueOnce(ok(META));

    await expect(fetchChartMeta()).resolves.toEqual(META);
    expect(get).toHaveBeenCalledWith('/analytics/chart-meta');
  });

  it('surfaces the backend message on failure', async () => {
    get.mockResolvedValueOnce(fail('analytics is down'));
    await expect(fetchChartMeta()).rejects.toThrow('analytics is down');
  });

  it('falls back to a readable message when the backend sends none', async () => {
    get.mockResolvedValueOnce(fail());
    await expect(fetchChartMeta()).rejects.toThrow('Could not load the chart description');
  });
});

describe('fetchChartData', () => {
  const range: ChartRangeOption = { range: '30d', label: '30 days', interval: '1d' };

  it('requests the range query and unwraps the buckets', async () => {
    get.mockResolvedValueOnce(ok(POINTS));

    await expect(fetchChartData(range)).resolves.toEqual(POINTS);
    expect(get).toHaveBeenCalledWith('/analytics/chart-data?range=30d&interval=1d');
  });

  it('accepts an empty series as a successful response', async () => {
    get.mockResolvedValueOnce(ok([]));
    await expect(fetchChartData(range)).resolves.toEqual([]);
  });

  it('surfaces the backend message on failure', async () => {
    get.mockResolvedValueOnce(fail('rate limited'));
    await expect(fetchChartData(range)).rejects.toThrow('rate limited');
  });

  it('falls back to a readable message when the backend sends none', async () => {
    get.mockResolvedValueOnce(fail());
    await expect(fetchChartData(range)).rejects.toThrow('Could not load the chart data');
  });

  it('appends an asset filter when one is passed', async () => {
    get.mockResolvedValueOnce(ok(POINTS));
    await fetchChartData(range, 'XLM');
    expect(get).toHaveBeenCalledWith('/analytics/chart-data?range=30d&interval=1d&asset=XLM');
  });
});

describe('portfolioChartLoader', () => {
  it('loads the descriptor once and serves a re-selected range from cache', async () => {
    get.mockResolvedValueOnce(ok(META)).mockResolvedValueOnce(ok(POINTS));

    await portfolioChartLoader.loadMeta();
    await portfolioChartLoader.load(META.ranges[0]);
    await portfolioChartLoader.load(META.ranges[0]);

    expect(get).toHaveBeenCalledTimes(2);
    expect(portfolioChartLoader.cachedRanges).toEqual(['7d:1h']);
  });

  it('evicts a failed range so a retry really retries', async () => {
    get.mockResolvedValueOnce(ok(META)).mockResolvedValueOnce(fail('offline')).mockResolvedValueOnce(ok(POINTS));

    await portfolioChartLoader.loadMeta();
    await expect(portfolioChartLoader.load(META.ranges[0])).rejects.toThrow('offline');
    expect(portfolioChartLoader.cachedRanges).toEqual([]);

    await expect(portfolioChartLoader.load(META.ranges[0])).resolves.toEqual(POINTS);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
