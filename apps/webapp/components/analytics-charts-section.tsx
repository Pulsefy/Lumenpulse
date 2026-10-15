"use client";

import { useState } from "react";
import { BarChart2, Table as TableIcon } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAnalyticsChart } from "@/hooks/useAnalyticsChart";
import type { ChartDataPoint, ChartMeta, ChartRangeOption } from "@/lib/analytics-service";

/** Below this many points a line chart says little, so the data is shown as a table. */
export const SPARSE_POINT_THRESHOLD = 3;

/**
 * Per-series styling by position. Each series also gets its own titled chart,
 * so identity never depends on colour: dash pattern and marker shape differ too.
 */
const SERIES_STYLES = [
  { color: "#60a5fa", dash: undefined, marker: "circle" },
  { color: "#f59e0b", dash: "6 4", marker: "square" },
  { color: "#34d399", dash: "2 3", marker: "triangle" },
] as const;

type Marker = (typeof SERIES_STYLES)[number]["marker"];

function formatTimestamp(iso: string, interval: ChartRangeOption["interval"]): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(interval === "1h" ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(iso));
}

function formatValue(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(3);
}

function valueOf(point: ChartDataPoint, key: string): unknown {
  return (point as unknown as Record<string, unknown>)[key];
}

function MarkerShape({ marker, cx, cy, color }: { marker: Marker; cx: number; cy: number; color: string }) {
  const r = 4;
  if (marker === "square") {
    return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} />;
  }
  if (marker === "triangle") {
    return <polygon points={`${cx},${cy - r - 1} ${cx - r - 1},${cy + r} ${cx + r + 1},${cy + r}`} fill={color} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={color} />;
}

function DataTable({
  meta,
  points,
  interval,
  caption,
}: {
  meta: ChartMeta;
  points: ChartDataPoint[];
  interval: ChartRangeOption["interval"];
  caption: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-gray-400 border-b border-white/10">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">{meta.xAxis.label}</th>
            {meta.series.map((s) => (
              <th key={s.key} scope="col" className="py-2 pr-4 font-medium text-right">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.timestamp} className="border-b border-white/5 last:border-0">
              <th scope="row" className="py-2 pr-4 font-normal text-gray-300">
                {formatTimestamp(point.timestamp, interval)}
              </th>
              {meta.series.map((s) => (
                <td key={s.key} className="py-2 pr-4 text-right text-gray-200 tabular-nums">
                  {formatValue(valueOf(point, s.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeriesChart({
  meta,
  seriesIndex,
  points,
  interval,
}: {
  meta: ChartMeta;
  seriesIndex: number;
  points: ChartDataPoint[];
  interval: ChartRangeOption["interval"];
}) {
  const series = meta.series[seriesIndex];
  const style = SERIES_STYLES[seriesIndex % SERIES_STYLES.length];
  const yAxisLabel = meta.yAxes.find((a) => a.id === series.axisId)?.label ?? series.label;

  return (
    <figure aria-label={`${series.label}, ${yAxisLabel} over ${meta.xAxis.label}`}>
      <figcaption className="flex items-center gap-2 text-sm font-medium text-gray-200 mb-2">
        <svg width="28" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="28" y2="5" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
          <MarkerShape marker={style.marker} cx={14} cy={5} color={style.color} />
        </svg>
        {series.label}
      </figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 24, left: 8 }} accessibilityLayer>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey={meta.xAxis.id}
              tickFormatter={(v: string) => formatTimestamp(v, interval)}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              stroke="rgba(255,255,255,0.15)"
              minTickGap={24}
              label={{ value: meta.xAxis.label, position: "insideBottom", offset: -16, fill: "#9ca3af", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              stroke="rgba(255,255,255,0.15)"
              width={56}
              label={{ value: yAxisLabel, angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11, style: { textAnchor: "middle" } }}
            />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)", fontSize: 12 }}
              labelStyle={{ color: "#e5e7eb" }}
              itemStyle={{ color: "#e5e7eb" }}
              labelFormatter={(v: string) => formatTimestamp(v, interval)}
              formatter={(v: unknown) => [formatValue(v), series.label]}
            />
            <Line
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={style.color}
              strokeWidth={2}
              strokeDasharray={style.dash}
              isAnimationActive={false}
              dot={points.length <= 48 ? (props: { cx?: number; cy?: number; key?: string }) => (
                <MarkerShape key={props.key} marker={style.marker} cx={props.cx ?? 0} cy={props.cy ?? 0} color={style.color} />
              ) : false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export default function AnalyticsChartsSection() {
  const { meta, selectedRange, selectRange, points, isLoading, error } = useAnalyticsChart();
  const [showTable, setShowTable] = useState(false);

  const isSparse = !!points && points.length < SPARSE_POINT_THRESHOLD;
  const caption = selectedRange ? `Analytics, ${selectedRange.label}` : "Analytics";

  return (
    <section aria-labelledby="analytics-heading">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <h2 id="analytics-heading" className="text-xl font-semibold">Analytics</h2>
        {meta && meta.ranges.length > 0 && (
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Time range" className="flex rounded-lg border border-white/10 p-0.5">
              {meta.ranges.map((r) => (
                <button
                  key={r.range}
                  type="button"
                  aria-pressed={selectedRange?.range === r.range}
                  onClick={() => selectRange(r.range)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    selectedRange?.range === r.range ? "bg-white/15 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!isSparse && (
              <button
                type="button"
                aria-pressed={showTable}
                onClick={() => setShowTable((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-white/10 text-gray-400 hover:text-white"
              >
                {showTable ? <BarChart2 size={14} aria-hidden="true" /> : <TableIcon size={14} aria-hidden="true" />}
                {showTable ? "Show charts" : "Show table"}
              </button>
            )}
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-rose-400">{error}</p>
      ) : isLoading || !meta || !selectedRange || !points ? (
        <div aria-busy="true" className="h-56 rounded-lg bg-white/5 animate-pulse" />
      ) : points.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">No data recorded for {selectedRange.label.toLowerCase()}.</p>
      ) : isSparse || showTable ? (
        <>
          {isSparse && (
            <p className="text-xs text-gray-500 mb-3">Too few data points to chart, showing the values instead.</p>
          )}
          <DataTable meta={meta} points={points} interval={selectedRange.interval} caption={caption} />
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {meta.series.map((s, i) => (
            <SeriesChart key={s.key} meta={meta} seriesIndex={i} points={points} interval={selectedRange.interval} />
          ))}
        </div>
      )}
    </section>
  );
}
