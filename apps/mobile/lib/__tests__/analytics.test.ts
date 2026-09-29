import {
  buildChartModel,
  createChartLoader,
  downsample,
  FALLBACK_RANGES,
  formatChartValue,
  MAX_POINTS_DEFAULT,
  MAX_POINTS_LOW_END,
  MIN_TREND_POINTS,
  measureChartBuild,
  normalizeRanges,
  pointsBudgetFor,
  rangeCacheKey,
  selectRange,
  seriesMarkerAt,
  summarizeForAccessibility,
  toFiniteNumber,
  type ChartDataPoint,
  type ChartMeta,
  type ChartRangeOption,
  type ChartSeriesMarker,
} from '../analytics';

const RANGES: ChartRangeOption[] = [
  { range: '7d', label: '7 days', interval: '1h' },
  { range: '30d', label: '30 days', interval: '1d' },
];

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
  ranges: RANGES,
};

const buildPoints = (count: number): ChartDataPoint[] =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    sentiment: i,
    count: i * 2,
  }));

describe('normalizeRanges', () => {
  it('uses the backend descriptor when it is well formed', () => {
    expect(normalizeRanges(META)).toEqual(RANGES);
  });

  it('falls back when the descriptor is missing, empty or malformed', () => {
    expect(normalizeRanges(null)).toEqual([...FALLBACK_RANGES]);
    expect(normalizeRanges(undefined)).toEqual([...FALLBACK_RANGES]);
    expect(normalizeRanges({ ...META, ranges: [] })).toEqual([...FALLBACK_RANGES]);
    expect(
      normalizeRanges({ ...META, ranges: [null, 42, {}] as unknown as ChartRangeOption[] }),
    ).toEqual([...FALLBACK_RANGES]);
  });

  it('drops entries without a range, interval or label and de-duplicates ranges', () => {
    const ranges = normalizeRanges({
      ...META,
      ranges: [
        { range: '7d', label: '7 days', interval: '1h' },
        { range: '7d', label: '7 days again', interval: '1h' },
        { range: '', label: 'broken', interval: '1h' },
        { range: '30d', label: '', interval: '1d' },
        { range: '90d', label: '90 days', interval: '1d' },
      ] as ChartRangeOption[],
    });

    expect(ranges).toEqual([
      { range: '7d', label: '7 days', interval: '1h' },
      { range: '90d', label: '90 days', interval: '1d' },
    ]);
  });
});

describe('selectRange', () => {
  it('prefers the requested range', () => {
    expect(selectRange(RANGES, '30d')).toEqual(RANGES[1]);
  });

  it('falls back to the first option for unknown or missing input', () => {
    expect(selectRange(RANGES, '1y')).toEqual(RANGES[0]);
    expect(selectRange(RANGES)).toEqual(RANGES[0]);
    expect(selectRange(RANGES, null)).toEqual(RANGES[0]);
    expect(selectRange([], '7d')).toEqual(FALLBACK_RANGES[0]);
  });
});

describe('pointsBudgetFor', () => {
  it('uses a smaller budget on the low-end profile', () => {
    expect(pointsBudgetFor('low')).toBe(MAX_POINTS_LOW_END);
    expect(pointsBudgetFor('default')).toBe(MAX_POINTS_DEFAULT);
    expect(pointsBudgetFor('low')).toBeLessThan(pointsBudgetFor('default'));
  });
});

describe('toFiniteNumber', () => {
  it('accepts numbers and numeric strings', () => {
    expect(toFiniteNumber(1.5)).toBe(1.5);
    expect(toFiniteNumber('2.5')).toBe(2.5);
    expect(toFiniteNumber('  3 ')).toBe(3);
    expect(toFiniteNumber(0)).toBe(0);
  });

  it('rejects everything that is not a finite number', () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber({})).toBeNull();
    expect(toFiniteNumber([])).toBeNull();
    expect(toFiniteNumber(true)).toBeNull();
  });
});

describe('downsample', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ timestamp: `t${i}`, value: i }));

  it('returns a copy when already within budget', () => {
    const result = downsample(points, 10);
    expect(result).toEqual(points);
    expect(result).not.toBe(points);
  });

  it('caps the output at the budget', () => {
    expect(downsample(points, 4)).toHaveLength(4);
    expect(downsample(buildPoints(500).map((p) => ({ timestamp: p.timestamp, value: p.sentiment ?? 0 })), 50)).toHaveLength(50);
    expect(downsample(buildPoints(101).map((p) => ({ timestamp: p.timestamp, value: p.sentiment ?? 0 })), 50)).toHaveLength(50);
  });

  it('averages neighbours and keeps the last timestamp of each bucket', () => {
    const result = downsample(points, 2);
    expect(result).toEqual([
      { timestamp: 't4', value: 2 },
      { timestamp: 't9', value: 7 },
    ]);
  });

  it('handles degenerate budgets and empty input safely', () => {
    expect(downsample(points, 0)).toEqual([]);
    expect(downsample(points, -3)).toEqual([]);
    expect(downsample(points, Number.NaN)).toEqual([]);
    expect(downsample([], 5)).toEqual([]);
  });
});

describe('seriesMarkerAt', () => {
  it('cycles through distinct symbol + line-style pairs', () => {
    const first: ChartSeriesMarker = seriesMarkerAt(0);
    const second = seriesMarkerAt(1);
    const third = seriesMarkerAt(2);
    const fourth = seriesMarkerAt(3);

    expect(new Set([first.symbol, second.symbol, third.symbol, fourth.symbol]).size).toBe(4);
    expect(new Set([first.description, second.description, third.description, fourth.description]).size).toBe(4);
    expect(seriesMarkerAt(4)).toEqual(first);
  });

  it('falls back to the first marker for invalid input', () => {
    expect(seriesMarkerAt(-1)).toEqual(seriesMarkerAt(0));
    expect(seriesMarkerAt(Number.NaN)).toEqual(seriesMarkerAt(0));
  });
});

describe('buildChartModel', () => {
  it('maps each series by its declared key', () => {
    const model = buildChartModel({ meta: META, points: buildPoints(5), activeRange: '7d' });

    expect(model.state).toBe('ready');
    expect(model.message).toBeNull();
    expect(model.series).toHaveLength(2);
    expect(model.series[0].key).toBe('sentiment');
    expect(model.series[0].points.map((p) => p.value)).toEqual([0, 1, 2, 3, 4]);
    expect(model.series[1].points.map((p) => p.value)).toEqual([0, 2, 4, 6, 8]);
    expect(model.series[0].latest).toBe(4);
    expect(model.series[0].min).toBe(0);
    expect(model.series[0].max).toBe(4);
    expect(model.valueRange).toEqual({ min: 0, max: 8 });
    expect(model.xLabel).toBe('Time');
    expect(model.yLabel).toBe('Sentiment');
    expect(model.activeRange).toEqual(RANGES[0]);
  });

  it('reports an empty series with an explanation instead of a blank chart', () => {
    const model = buildChartModel({ meta: META, points: [], activeRange: '30d' });

    expect(model.state).toBe('empty');
    expect(model.message).toContain('30 days');
    expect(model.pointCount).toBe(0);
    expect(model.series[0].latest).toBeNull();
    expect(model.series[0].min).toBeNull();
    expect(model.series[0].max).toBeNull();
    expect(model.valueRange).toBeNull();
  });

  it('flags a series with fewer than three buckets as sparse, not as a trend', () => {
    const sparse = buildChartModel({ meta: META, points: buildPoints(MIN_TREND_POINTS - 1) });
    expect(sparse.state).toBe('sparse');
    expect(sparse.message).toContain('2 data points');

    const single = buildChartModel({ meta: META, points: buildPoints(1) });
    expect(single.state).toBe('sparse');
    expect(single.message).toContain('1 data point in');

    expect(buildChartModel({ meta: META, points: buildPoints(MIN_TREND_POINTS) }).state).toBe('ready');
  });

  it('ignores unusable buckets rather than plotting NaN', () => {
    const points: ChartDataPoint[] = [
      { timestamp: 'a', sentiment: 1, count: 1 },
      { timestamp: '', sentiment: 2, count: 2 },
      { timestamp: 'c', sentiment: Number.NaN, count: 3 },
      { timestamp: 'd', sentiment: 'not-a-number', count: 4 },
      { timestamp: 'e', sentiment: Number.POSITIVE_INFINITY, count: 5 },
      { timestamp: 'f', count: 6 },
      { timestamp: 'g', sentiment: '4.5', count: 7 },
    ] as ChartDataPoint[];

    const model = buildChartModel({ meta: META, points });

    expect(model.series[0].points).toEqual([
      { timestamp: 'a', value: 1 },
      { timestamp: 'g', value: 4.5 },
    ]);
    expect(model.series.every((s) => s.points.every((p) => Number.isFinite(p.value)))).toBe(true);
  });

  it('never hands more than the low-end budget to the renderer', () => {
    const model = buildChartModel({
      meta: META,
      points: buildPoints(2000),
      maxPoints: pointsBudgetFor('low'),
    });

    expect(model.maxPoints).toBe(MAX_POINTS_LOW_END);
    expect(model.pointCount).toBe(2000);
    expect(model.renderedPointCount).toBe(MAX_POINTS_LOW_END * 2);
    expect(model.series.every((s) => s.points.length <= MAX_POINTS_LOW_END)).toBe(true);
  });

  it('counts buckets once, not once per series', () => {
    const model = buildChartModel({ meta: META, points: buildPoints(5) });

    expect(model.series).toHaveLength(2);
    expect(model.pointCount).toBe(5);
    expect(model.renderedPointCount).toBe(10);
  });

  it('falls back to a sane default when the descriptor is missing', () => {
    const model = buildChartModel({ meta: null, points: buildPoints(4) });

    expect(model.series).toHaveLength(1);
    expect(model.series[0].key).toBe('sentiment');
    expect(model.ranges).toEqual([...FALLBACK_RANGES]);
    expect(model.yLabel).toBe('Value');
    expect(model.xLabel).toBe('Time');
    expect(model.state).toBe('ready');
  });

  it('resolves the axis label through axisId and degrades gracefully', () => {
    const shifted: ChartMeta = {
      ...META,
      series: [{ key: 'count', label: 'Mentions', axisId: 'unknown-axis' }],
    };
    expect(buildChartModel({ meta: shifted, points: buildPoints(3) }).yLabel).toBe('Sentiment');

    const noAxes: ChartMeta = { ...META, yAxes: [] };
    expect(buildChartModel({ meta: noAxes, points: buildPoints(3) }).yLabel).toBe('Value');
  });

  it('gives every series a distinct non-colour identity', () => {
    const model = buildChartModel({ meta: META, points: buildPoints(4) });
    const markers = model.series.map((s) => `${s.symbol}|${s.lineStyle}`);

    expect(new Set(markers).size).toBe(markers.length);
    expect(model.series.every((s) => s.description.length > 0)).toBe(true);
  });

  it('falls back to the default budget for a nonsense maxPoints', () => {
    expect(buildChartModel({ meta: META, points: buildPoints(3), maxPoints: 0 }).maxPoints).toBe(
      MAX_POINTS_DEFAULT,
    );
    expect(
      buildChartModel({ meta: META, points: buildPoints(3), maxPoints: Number.NaN }).maxPoints,
    ).toBe(MAX_POINTS_DEFAULT);
  });
});

describe('formatChartValue', () => {
  it('formats with a precision that fits the magnitude', () => {
    expect(formatChartValue(null)).toBe('—');
    expect(formatChartValue(Number.NaN)).toBe('—');
    expect(formatChartValue(1.2345)).toBe('1.23');
    expect(formatChartValue(12.345)).toBe('12.3');
    expect(formatChartValue(12345.6)).toBe('12346');
    expect(formatChartValue(-3.5)).toBe('-3.50');
  });
});

describe('summarizeForAccessibility', () => {
  it('names every series and its marker so the chart is usable without colour', () => {
    const summary = summarizeForAccessibility(
      buildChartModel({ meta: META, points: buildPoints(4), activeRange: '30d' }),
    );

    expect(summary).toContain('Sentiment over 30 days');
    expect(summary).toContain('Mentions');
    expect(summary).toContain('circle, solid line');
    expect(summary).toContain('square, dashed line');
    expect(summary).toContain('latest 6');
  });

  it('explains the empty state', () => {
    const summary = summarizeForAccessibility(buildChartModel({ meta: META, points: [] }));
    expect(summary).toContain('No data for 7 days yet');
  });

  it('mentions the sparse state without hiding the values it has', () => {
    const summary = summarizeForAccessibility(
      buildChartModel({ meta: META, points: buildPoints(2) }),
    );
    expect(summary).toContain('not enough to show a trend yet');
    expect(summary).toContain('latest 1');
  });
});

describe('measureChartBuild', () => {
  it('reports the measured cost of preparing a low-end render window', () => {
    // The budget is deliberately generous: this runs on shared CI runners and on
    // developer machines under load, so the timing check is a smoke guard against
    // accidentally super-linear work, not a benchmark. The hard guarantee is the
    // point budget asserted below and in the loader tests.
    const measurement = measureChartBuild(META, 2000, 5, 2000, pointsBudgetFor('low'));

    expect(measurement.pointsPerBuild).toBe(2000);
    expect(measurement.iterations).toBe(5);
    expect(measurement.budgetMs).toBe(2000);
    expect(Number.isFinite(measurement.msPerBuild)).toBe(true);
    expect(measurement.msPerBuild).toBeGreaterThanOrEqual(0);
    expect(measurement.totalMs).toBeLessThan(measurement.budgetMs);
    expect(measurement.withinBudget).toBe(true);

    // Reported in the PR body: this is the measurement behind "stays smooth on a
    // low-end device profile", printed here so CI records it on every run.
    console.log(
      `chart build: ${measurement.msPerBuild.toFixed(2)} ms/build for ` +
        `${measurement.pointsPerBuild} buckets (${measurement.totalMs.toFixed(2)} ms total)`,
    );
  });

  it('never exceeds the requested point budget', () => {
    measureChartBuild(META, 5000, 1);
    const model = buildChartModel({
      meta: META,
      points: buildPoints(5000),
      maxPoints: pointsBudgetFor('low'),
    });

    expect(model.pointCount).toBe(5000);
    expect(model.renderedPointCount).toBe(MAX_POINTS_LOW_END * 2);
    expect(model.series.every((s) => s.points.length <= MAX_POINTS_LOW_END)).toBe(true);
  });
});

describe('createChartLoader', () => {
  it('fetches a range once, then serves it from cache', async () => {
    const fetchData = jest.fn().mockResolvedValue(buildPoints(3));
    const loader = createChartLoader({
      fetchMeta: jest.fn().mockResolvedValue(META),
      fetchData,
    });

    const first = await loader.load(RANGES[0]);
    const second = await loader.load(RANGES[0]);

    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(loader.cachedRanges).toEqual([rangeCacheKey(RANGES[0])]);
  });

  it('keeps each range separate so switching ranges refetches at most once', async () => {
    const fetchData = jest.fn().mockResolvedValue(buildPoints(3));
    const loader = createChartLoader({ fetchMeta: jest.fn(), fetchData });

    await Promise.all([loader.load(RANGES[0]), loader.load(RANGES[1])]);
    await Promise.all([loader.load(RANGES[0]), loader.load(RANGES[1])]);

    expect(fetchData).toHaveBeenCalledTimes(2);
    expect(loader.cachedRanges.sort()).toEqual(['30d:1d', '7d:1h']);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let release: (points: ChartDataPoint[]) => void = () => {
      throw new Error('fetch was never started');
    };
    const fetchData = jest.fn().mockImplementation(
      () =>
        new Promise<ChartDataPoint[]>((resolve) => {
          release = resolve;
        }),
    );
    const loader = createChartLoader({ fetchMeta: jest.fn(), fetchData });

    const a = loader.load(RANGES[0]);
    const b = loader.load(RANGES[0]);
    expect(fetchData).toHaveBeenCalledTimes(1);
    release(buildPoints(2));

    await expect(a).resolves.toHaveLength(2);
    await expect(b).resolves.toHaveLength(2);
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it('refetches once the ttl elapses', async () => {
    let now = 1_000;
    const fetchData = jest.fn().mockResolvedValue(buildPoints(3));
    const loader = createChartLoader({ fetchMeta: jest.fn(), fetchData }, {
      ttlMs: 500,
      now: () => now,
    });

    await loader.load(RANGES[0]);
    now = 1_400;
    await loader.load(RANGES[0]);
    expect(fetchData).toHaveBeenCalledTimes(1);

    now = 1_600;
    await loader.load(RANGES[0]);
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('evicts a failed request so the next selection retries', async () => {
    const fetchData = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(buildPoints(3));
    const loader = createChartLoader({ fetchMeta: jest.fn(), fetchData });

    await expect(loader.load(RANGES[0])).rejects.toThrow('offline');
    expect(loader.cachedRanges).toEqual([]);

    await expect(loader.load(RANGES[0])).resolves.toHaveLength(3);
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('caches the chart descriptor and supports explicit invalidation', async () => {
    const fetchMeta = jest.fn().mockResolvedValue(META);
    const fetchData = jest.fn().mockResolvedValue(buildPoints(3));
    const loader = createChartLoader({ fetchMeta, fetchData });

    await loader.loadMeta();
    await loader.loadMeta();
    expect(fetchMeta).toHaveBeenCalledTimes(1);

    await loader.load(RANGES[0]);
    loader.invalidate(RANGES[0]);
    expect(loader.cachedRanges).toEqual([]);
    await loader.load(RANGES[0]);
    expect(fetchData).toHaveBeenCalledTimes(2);

    loader.invalidate();
    await loader.loadMeta();
    expect(fetchMeta).toHaveBeenCalledTimes(2);
  });

  it('retries the descriptor after a failure', async () => {
    const fetchMeta = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(META);
    const loader = createChartLoader({ fetchMeta, fetchData: jest.fn() });

    await expect(loader.loadMeta()).rejects.toThrow('boom');
    await expect(loader.loadMeta()).resolves.toEqual(META);
    expect(fetchMeta).toHaveBeenCalledTimes(2);
  });
});
