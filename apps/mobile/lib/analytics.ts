/**
 * Portfolio analytics charts — pure data layer.
 *
 * The portfolio tab shows figures from `/portfolio/summary` but has no way to
 * show how a position moved over time. This module turns the backend's
 * `/analytics/chart-meta` descriptor plus `/analytics/chart-data` buckets into a
 * ready-to-render {@link ChartModel}, and keeps every decision that can be
 * wrong — range selection, series mapping, downsampling, empty/sparse handling,
 * accessibility text and render-cost measurement — free of React Native imports
 * so it can be unit tested in the app's node test environment.
 */

/** Axis descriptor served by `GET /analytics/chart-meta`. */
export interface ChartAxisMeta {
  id: string;
  label: string;
}

/** Series descriptor served by `GET /analytics/chart-meta`. */
export interface ChartSeriesMeta {
  /** Property of the chart data point that holds this series' values. */
  key: string;
  label: string;
  axisId: string;
}

/** One selectable time range, served by `GET /analytics/chart-meta`. */
export interface ChartRangeOption {
  range: string;
  label: string;
  interval: string;
}

/** Full `GET /analytics/chart-meta` payload. */
export interface ChartMeta {
  xAxis: ChartAxisMeta;
  yAxes: ChartAxisMeta[];
  series: ChartSeriesMeta[];
  ranges: ChartRangeOption[];
}

/** One bucket from `GET /analytics/chart-data`. Values are read by series key. */
export interface ChartDataPoint {
  timestamp: string;
  sentiment?: number;
  count?: number;
  [key: string]: string | number | undefined;
}

/** A single plotted value. */
export interface SeriesPoint {
  timestamp: string;
  value: number;
}

/**
 * Visual + textual identity for a series. The symbol and line style are the
 * non-colour channel: two series must never differ by hue alone.
 */
export interface ChartSeriesMarker {
  symbol: string;
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
  /** Screen-reader name for the marker, e.g. "circle, solid line". */
  description: string;
}

export interface ChartSeries extends ChartSeriesMarker {
  key: string;
  label: string;
  axisId: string;
  points: SeriesPoint[];
  latest: number | null;
  min: number | null;
  max: number | null;
}

export type ChartState = 'ready' | 'sparse' | 'empty';

export interface ChartModel {
  state: ChartState;
  /** Explanation shown to the user when the series is empty or sparse. */
  message: string | null;
  series: ChartSeries[];
  ranges: ChartRangeOption[];
  activeRange: ChartRangeOption;
  /** Buckets received from the backend that carry at least one plottable value. */
  pointCount: number;
  /** Points actually handed to the renderer, across every series. */
  renderedPointCount: number;
  maxPoints: number;
  xLabel: string;
  yLabel: string;
  valueRange: { min: number; max: number } | null;
}

/** Ranges used when the backend descriptor is missing or unusable. */
export const FALLBACK_RANGES: readonly ChartRangeOption[] = [
  { range: '7d', label: '7 days', interval: '1h' },
  { range: '30d', label: '30 days', interval: '1d' },
];

/** Fewer than this many buckets is not a trend yet. */
export const MIN_TREND_POINTS = 3;

/** Point budget for a low-end device profile. */
export const MAX_POINTS_LOW_END = 40;
/** Point budget for the default profile. */
export const MAX_POINTS_DEFAULT = 120;

export type DeviceTier = 'low' | 'default';

const SERIES_MARKERS: readonly ChartSeriesMarker[] = [
  { symbol: '●', lineStyle: 'solid', description: 'circle, solid line' },
  { symbol: '■', lineStyle: 'dashed', description: 'square, dashed line' },
  { symbol: '▲', lineStyle: 'dotted', description: 'triangle, dotted line' },
  { symbol: '◆', lineStyle: 'dash-dot', description: 'diamond, dash-dot line' },
];

const isRangeOption = (value: unknown): value is ChartRangeOption => {
  if (typeof value !== 'object' || value === null) return false;
  const option = value as Partial<ChartRangeOption>;
  return (
    typeof option.range === 'string' &&
    option.range.length > 0 &&
    typeof option.interval === 'string' &&
    option.interval.length > 0 &&
    typeof option.label === 'string' &&
    option.label.length > 0
  );
};

/**
 * Range options to render for a selector, taken from the backend descriptor and
 * de-duplicated by `range`, falling back to {@link FALLBACK_RANGES} when the
 * descriptor is missing, empty or malformed.
 */
export function normalizeRanges(meta: ChartMeta | null | undefined): ChartRangeOption[] {
  const raw = meta?.ranges;
  if (!Array.isArray(raw)) return [...FALLBACK_RANGES];

  const seen = new Set<string>();
  const options: ChartRangeOption[] = [];
  for (const candidate of raw) {
    if (!isRangeOption(candidate) || seen.has(candidate.range)) continue;
    seen.add(candidate.range);
    options.push({
      range: candidate.range,
      label: candidate.label,
      interval: candidate.interval,
    });
  }

  return options.length > 0 ? options : [...FALLBACK_RANGES];
}

/**
 * The range to start on: the requested one when it exists, otherwise the first
 * option. Never throws — an unknown range degrades to a working chart.
 */
export function selectRange(
  ranges: readonly ChartRangeOption[],
  wanted?: string | null,
): ChartRangeOption {
  const options = ranges.length > 0 ? ranges : [...FALLBACK_RANGES];
  const match = wanted ? options.find((option) => option.range === wanted) : undefined;
  return match ?? options[0];
}

/** Point budget for a device tier. */
export function pointsBudgetFor(tier: DeviceTier): number {
  return tier === 'low' ? MAX_POINTS_LOW_END : MAX_POINTS_DEFAULT;
}

/** Coerces a bucket value to a finite number, or `null` when unusable. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Reduces `points` to at most `maxPoints` buckets by averaging neighbours.
 *
 * The first and last buckets keep their original boundary values' timestamps so
 * the plotted range still covers the requested window.
 */
export function downsample(points: readonly SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (!Number.isFinite(maxPoints) || maxPoints < 1) return [];
  const budget = Math.floor(maxPoints);
  if (points.length <= budget) return points.slice();

  const bucketSize = points.length / budget;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < budget; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(points.length, Math.max(start + 1, Math.floor((i + 1) * bucketSize)));
    let sum = 0;
    let count = 0;
    let lastTimestamp = points[start].timestamp;
    for (let j = start; j < end; j += 1) {
      sum += points[j].value;
      count += 1;
      lastTimestamp = points[j].timestamp;
    }
    out.push({ timestamp: lastTimestamp, value: count > 0 ? sum / count : 0 });
  }
  return out;
}

/** Marker (symbol + line style) for the series at `index`. */
export function seriesMarkerAt(index: number): ChartSeriesMarker {
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return SERIES_MARKERS[safeIndex % SERIES_MARKERS.length];
}

function seriesValues(points: readonly ChartDataPoint[], key: string): SeriesPoint[] {
  const values: SeriesPoint[] = [];
  for (const point of points) {
    if (typeof point?.timestamp !== 'string' || point.timestamp.length === 0) continue;
    const value = toFiniteNumber(point[key]);
    if (value === null) continue;
    values.push({ timestamp: point.timestamp, value });
  }
  return values;
}

export interface BuildChartModelInput {
  meta: ChartMeta | null | undefined;
  points: readonly ChartDataPoint[];
  activeRange?: ChartRangeOption | string | null;
  /** Point budget handed to the renderer. Defaults to the default profile. */
  maxPoints?: number;
}

/**
 * Builds the render model for the portfolio chart.
 *
 * Handles the three states the UI must distinguish: a complete series
 * (`ready`), a series with too few buckets to be a trend (`sparse`) and no data
 * at all (`empty`). Both degraded states carry a user-facing `message`.
 */
export function buildChartModel({
  meta,
  points,
  activeRange,
  maxPoints = MAX_POINTS_DEFAULT,
}: BuildChartModelInput): ChartModel {
  const ranges = normalizeRanges(meta);
  const wanted = typeof activeRange === 'string' ? activeRange : activeRange?.range;
  const selectedRange = selectRange(ranges, wanted);
  const budget = Number.isFinite(maxPoints) && maxPoints > 0 ? Math.floor(maxPoints) : MAX_POINTS_DEFAULT;

  const seriesMeta: ChartSeriesMeta[] =
    meta && Array.isArray(meta.series) && meta.series.length > 0
      ? meta.series
      : [{ key: 'sentiment', label: 'Sentiment', axisId: meta?.yAxes?.[0]?.id ?? 'y' }];

  // Buckets that carry at least one plottable value for one of the declared
  // series. Counted once per bucket (not once per series) so "is this a trend
  // yet?" is decided on the data the user actually gets.
  const usableBuckets = (points ?? []).filter(
    (point) =>
      typeof point?.timestamp === 'string' &&
      point.timestamp.length > 0 &&
      seriesMeta.some((descriptor) => toFiniteNumber(point[descriptor.key]) !== null),
  );
  const pointCount = usableBuckets.length;

  const series: ChartSeries[] = seriesMeta.map((descriptor, index) => {
    const values = seriesValues(usableBuckets, descriptor.key);
    const sampled = downsample(values, budget);
    const numbers = sampled.map((point) => point.value);

    return {
      key: descriptor.key,
      label: descriptor.label,
      axisId: descriptor.axisId,
      ...seriesMarkerAt(index),
      points: sampled,
      latest: numbers.length > 0 ? numbers[numbers.length - 1] : null,
      min: numbers.length > 0 ? Math.min(...numbers) : null,
      max: numbers.length > 0 ? Math.max(...numbers) : null,
    };
  });

  const allValues = series.flatMap((entry) => entry.points.map((point) => point.value));
  const valueRange =
    allValues.length > 0 ? { min: Math.min(...allValues), max: Math.max(...allValues) } : null;

  const primaryAxis =
    meta?.yAxes?.find((axis) => axis.id === series[0]?.axisId) ?? meta?.yAxes?.[0];

  let state: ChartState = 'ready';
  let message: string | null = null;

  if (pointCount === 0) {
    state = 'empty';
    message = `No data for ${selectedRange.label.toLowerCase()} yet. Pick another range or pull to refresh.`;
  } else if (pointCount < MIN_TREND_POINTS) {
    state = 'sparse';
    message = `Only ${pointCount} data point${pointCount === 1 ? '' : 's'} in ${selectedRange.label.toLowerCase()} — not enough to show a trend yet.`;
  }

  return {
    state,
    message,
    series,
    ranges,
    activeRange: selectedRange,
    pointCount,
    renderedPointCount: series.reduce((total, entry) => total + entry.points.length, 0),
    maxPoints: budget,
    xLabel: meta?.xAxis?.label ?? 'Time',
    yLabel: primaryAxis?.label ?? 'Value',
    valueRange,
  };
}

/** Formats a plotted value for the legend and for screen readers. */
export function formatChartValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/**
 * Text alternative for the chart. Names each series and its marker, so a
 * screen-reader user gets the same series distinction the legend gives visually.
 */
export function summarizeForAccessibility(model: ChartModel): string {
  const head = `${model.yLabel} over ${model.activeRange.label}`;
  if (model.state === 'empty') return `${head}. ${model.message ?? 'No data.'}`;

  const parts = model.series.map((entry) => {
    const range =
      entry.min === null || entry.max === null
        ? 'no values'
        : `latest ${formatChartValue(entry.latest)}, from ${formatChartValue(entry.min)} to ${formatChartValue(entry.max)}`;
    return `${entry.label} (${entry.description}): ${range}`;
  });
  const tail = model.state === 'sparse' && model.message ? ` ${model.message}` : '';
  return `${head}. ${parts.join('. ')}.${tail}`;
}

export interface ChartBuildMeasurement {
  /** Buckets fed into each build. */
  pointsPerBuild: number;
  iterations: number;
  totalMs: number;
  msPerBuild: number;
  budgetMs: number;
  withinBudget: boolean;
}

const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Measures how long {@link buildChartModel} needs for `pointsPerBuild` buckets.
 *
 * This is the reported measurement behind "the chart stays smooth on a low-end
 * device profile": the renderer never receives more than
 * {@link MAX_POINTS_LOW_END} buckets, and this records what preparing them
 * costs. Exposed as a pure function so the numbers can be asserted in CI
 * instead of being taken on trust.
 */
export function measureChartBuild(
  meta: ChartMeta | null | undefined,
  pointsPerBuild: number,
  iterations = 1,
  budgetMs = 100,
  maxPoints: number = MAX_POINTS_LOW_END,
): ChartBuildMeasurement {
  const safeIterations = Number.isFinite(iterations) && iterations > 0 ? Math.floor(iterations) : 1;
  const buckets: ChartDataPoint[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(pointsPerBuild)); i += 1) {
    buckets.push({
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
      sentiment: Math.sin(i / 12) * 50 + 50,
      count: i % 97,
    });
  }

  const startedAt = monotonicNow();
  for (let i = 0; i < safeIterations; i += 1) {
    buildChartModel({ meta, points: buckets, maxPoints });
  }
  const totalMs = monotonicNow() - startedAt;
  const msPerBuild = totalMs / safeIterations;

  return {
    pointsPerBuild: buckets.length,
    iterations: safeIterations,
    totalMs,
    msPerBuild,
    budgetMs,
    withinBudget: totalMs <= budgetMs,
  };
}

export interface ChartLoaderDeps {
  /** Fetches `GET /analytics/chart-meta`. */
  fetchMeta: () => Promise<ChartMeta>;
  /** Fetches `GET /analytics/chart-data` for one range. */
  fetchData: (range: ChartRangeOption) => Promise<ChartDataPoint[]>;
}

export interface ChartLoaderOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface ChartLoader {
  /** Returns cached buckets for the range, or fetches them once. */
  load(range: ChartRangeOption): Promise<ChartDataPoint[]>;
  /** Fetches the chart descriptor, cached for the lifetime of the loader. */
  loadMeta(): Promise<ChartMeta>;
  /** Drops one range, or everything when called with no argument. */
  invalidate(range?: ChartRangeOption): void;
  readonly cachedRanges: string[];
}

export const rangeCacheKey = (range: ChartRangeOption): string => `${range.range}:${range.interval}`;

/**
 * Small in-memory, promise-sharing cache in front of the analytics endpoints.
 *
 * Switching between the portfolio tab and the other tabs reconstitutes the
 * screen but not the module, so a re-selected range is served from here instead
 * of hitting the network again. Concurrent callers share one request, and a
 * failed request is evicted so the next selection retries.
 */
export function createChartLoader(
  deps: ChartLoaderDeps,
  options: ChartLoaderOptions = {},
): ChartLoader {
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  const ranges = new Map<string, { storedAt: number; promise: Promise<ChartDataPoint[]> }>();
  let metaPromise: Promise<ChartMeta> | null = null;

  return {
    load(range: ChartRangeOption): Promise<ChartDataPoint[]> {
      const key = rangeCacheKey(range);
      const hit = ranges.get(key);
      if (hit && now() - hit.storedAt < ttlMs) return hit.promise;

      const promise = deps.fetchData(range).catch((error: unknown) => {
        ranges.delete(key);
        throw error;
      });
      ranges.set(key, { storedAt: now(), promise });
      return promise;
    },

    loadMeta(): Promise<ChartMeta> {
      if (metaPromise) return metaPromise;
      metaPromise = deps.fetchMeta().catch((error: unknown) => {
        metaPromise = null;
        throw error;
      });
      return metaPromise;
    },

    invalidate(range?: ChartRangeOption): void {
      if (range) {
        ranges.delete(rangeCacheKey(range));
        return;
      }
      ranges.clear();
      metaPromise = null;
    },

    get cachedRanges(): string[] {
      return [...ranges.keys()];
    },
  };
}
