"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  FileText,
  BarChart3,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clientConfig } from "@/lib/config";
import { useStellarWallet } from "@/app/providers";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { toast } from "sonner";

const API_BASE = clientConfig.apiUrl;

type ReviewDomain = "moderation" | "anomaly";
type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";
type AnomalyStatus = "open" | "investigating" | "resolved" | "false_positive";

interface AgingBucket {
  label: string;
  minHours: number;
  maxHours: number | null;
  count: number;
}

interface DomainAgingSnapshot {
  domain: ReviewDomain;
  totalOpen: number;
  averageAgeMs: number;
  medianAgeMs: number | null;
  oldestAgeMs: number | null;
  newestAgeMs: number | null;
  buckets: AgingBucket[];
}

interface ReviewMetricsResponse {
  computedAt: string;
  domains: DomainAgingSnapshot[];
  grandTotalOpen: number;
}

interface ReviewMetricsQuery {
  domain?: ReviewDomain;
  moderationStatus?: ReportStatus;
  anomalyStatus?: AnomalyStatus;
  reviewerId?: string;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDomainColor(domain: ReviewDomain): string {
  return domain === "moderation" ? "text-purple-400" : "text-orange-400";
}

function getDomainBg(domain: ReviewDomain): string {
  return domain === "moderation" ? "bg-purple-500/10" : "bg-orange-500/10";
}

function getDomainBorder(domain: ReviewDomain): string {
  return domain === "moderation" ? "border-purple-500/20" : "border-orange-500/20";
}

export default function ReviewAgingDashboard() {
  const { publicKey } = useStellarWallet();
  const [metrics, setMetrics] = useState<ReviewMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<ReviewMetricsQuery>({});
  const [expandedDomain, setExpandedDomain] = useState<ReviewDomain | null>(null);

  const fetchMetrics = async () => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.moderationStatus) params.set("moderationStatus", query.moderationStatus);
    if (query.anomalyStatus) params.set("anomalyStatus", query.anomalyStatus);
    if (query.reviewerId) params.set("reviewerId", query.reviewerId);

    try {
      const res = await fetch(`${API_BASE}/review-metrics/aging?${params}`);
      if (!res.ok) {
        if (res.status === 403) throw new Error("Admin access required");
        throw new Error(`Failed to fetch metrics (${res.status})`);
      }
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [query]);

  const handleRefresh = () => {
    toast.loading("Refreshing metrics...", { id: "refresh-metrics" });
    fetchMetrics().then(() => {
      toast.success("Metrics refreshed", { id: "refresh-metrics" });
    });
  };

  if (isLoading && !metrics) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-6xl py-16 px-4">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold font-heading tracking-tight">
                Review Aging Dashboard
              </h1>
              <p className="text-foreground/50 mt-1">
                Monitor pending review items across moderation and anomaly detection
              </p>
            </div>
            <ListSkeleton count={3} variant="list" rowHeight={120} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-6xl py-16 px-4">
          <ListError message={error} onRetry={handleRefresh} />
        </div>
      </div>
    );
  }

  if (!metrics || metrics.grandTotalOpen === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-6xl py-16 px-4">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold font-heading tracking-tight">
                Review Aging Dashboard
              </h1>
              <p className="text-foreground/50 mt-1">
                Monitor pending review items across moderation and anomaly detection
              </p>
            </div>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-sm font-medium hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
          <EmptyState
            icon={CheckCircle2}
            title="All caught up!"
            description="No pending review items across all domains. Great work!"
          />
        </div>
      </div>
    );
  }

  const moderationDomain = metrics.domains.find((d) => d.domain === "moderation");
  const anomalyDomain = metrics.domains.find((d) => d.domain === "anomaly");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-6xl py-16 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              Review Aging Dashboard
            </h1>
            <p className="text-foreground/50 mt-1">
              Monitor pending review items across moderation and anomaly detection
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground/40 font-mono">
              Updated: {formatDate(metrics.computedAt)}
            </span>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-sm font-medium hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Total Open Items</p>
                <p className="font-bold text-2xl text-primary">{metrics.grandTotalOpen}</p>
              </div>
            </div>
          </div>
          {moderationDomain && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-foreground/50 text-sm">Moderation Reports</p>
                  <p className="font-bold text-2xl text-purple-400">
                    {moderationDomain.totalOpen}
                  </p>
                </div>
              </div>
            </div>
          )}
          {anomalyDomain && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-foreground/50 text-sm">Anomaly Flags</p>
                  <p className="font-bold text-2xl text-orange-400">
                    {anomalyDomain.totalOpen}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-foreground/50 text-sm">Avg Resolution Time</p>
                <p className="font-bold text-2xl text-emerald-400">
                  {metrics.domains.length > 0
                    ? formatDuration(
                        metrics.domains.reduce((acc, d) => acc + d.averageAgeMs, 0) /
                          metrics.domains.length
                      )
                    : "N/A"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 text-sm text-foreground/60">
              Domain:
              <select
                value={query.domain || ""}
                onChange={(e) =>
                  setQuery({ ...query, domain: e.target.value || undefined })
                }
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">All Domains</option>
                <option value="moderation">Moderation</option>
                <option value="anomaly">Anomaly</option>
              </select>
            </label>
            {query.domain === "moderation" || !query.domain ? (
              <label className="flex items-center gap-2 text-sm text-foreground/60">
                Moderation Status:
                <select
                  value={query.moderationStatus || ""}
                  onChange={(e) =>
                    setQuery({ ...query, moderationStatus: e.target.value || undefined })
                  }
                  className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="under_review">Under Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </label>
            ) : null}
            {query.domain === "anomaly" || !query.domain ? (
              <label className="flex items-center gap-2 text-sm text-foreground/60">
                Anomaly Status:
                <select
                  value={query.anomalyStatus || ""}
                  onChange={(e) =>
                    setQuery({ ...query, anomalyStatus: e.target.value || undefined })
                  }
                  className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="resolved">Resolved</option>
                  <option value="false_positive">False Positive</option>
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-foreground/60 ml-auto">
              Reviewer:
              <input
                type="text"
                placeholder="Reviewer ID"
                value={query.reviewerId || ""}
                onChange={(e) =>
                  setQuery({ ...query, reviewerId: e.target.value || undefined })
                }
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm w-48 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </label>
          </div>
        </div>

        {/* Domain Cards */}
        <div className="space-y-6">
          {moderationDomain && (
            <DomainAgingCard
              domain="moderation"
              data={moderationDomain}
              expanded={expandedDomain === "moderation"}
              onToggle={() =>
                setExpandedDomain((prev) => (prev === "moderation" ? null : "moderation"))
              }
              icon={Users}
              iconBg="bg-purple-500/10"
              iconColor="text-purple-400"
            />
          )}
          {anomalyDomain && (
            <DomainAgingCard
              domain="anomaly"
              data={anomalyDomain}
              expanded={expandedDomain === "anomaly"}
              onToggle={() =>
                setExpandedDomain((prev) => (prev === "anomaly" ? null : "anomaly"))
              }
              icon={AlertTriangle}
              iconBg="bg-orange-500/10"
              iconColor="text-orange-400"
            />
          )}
        </div>

        {/* Legend */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <h3 className="font-semibold mb-3">Aging Bucket Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {moderationDomain?.buckets.map((bucket) => (
              <div
                key={bucket.label}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5"
              >
                <div
                  className="w-3 h-3 rounded"
                  style={{
                    backgroundColor:
                      bucket.maxHours === null
                        ? "theme('colors.red.500')"
                        : bucket.minHours < 24
                        ? "theme('colors.emerald.500')"
                        : bucket.minHours < 72
                        ? "theme('colors.amber.500')"
                        : "theme('colors.orange.500')",
                  }}
                />
                <span className="text-foreground/70">{bucket.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DomainAgingCardProps {
  domain: ReviewDomain;
  data: DomainAgingSnapshot;
  expanded: boolean;
  onToggle: () => void;
  icon: typeof Users;
  iconBg: string;
  iconColor: string;
}

function DomainAgingCard({
  domain,
  data,
  expanded,
  onToggle,
  icon: Icon,
  iconBg,
  iconColor,
}: DomainAgingCardProps) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-5 flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className={cn("p-3 rounded-xl", iconBg)}>
            <Icon className={cn("w-6 h-6", iconColor)} />
          </div>
          <div>
            <h3 className="text-lg font-semibold capitalize">{domain}</h3>
            <p className="text-foreground/50 text-sm">
              {data.totalOpen} open items · Avg age: {formatDuration(data.averageAgeMs)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-2xl font-bold font-mono text-primary">{data.totalOpen}</p>
            <p className="text-xs text-foreground/40">Total Open</p>
          </div>
          <div className={cn(
            "transition-transform",
            expanded && "rotate-180"
          )}>
            <ChevronDown className="w-5 h-5 text-foreground/40" />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/5 p-5 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <MetricCard
              label="Oldest Item"
              value={formatDuration(data.oldestAgeMs)}
              icon={Clock}
              color="text-red-400"
              bg="bg-red-500/10"
            />
            <MetricCard
              label="Newest Item"
              value={formatDuration(data.newestAgeMs)}
              icon={Clock}
              color="text-emerald-400"
              bg="bg-emerald-500/10"
            />
            <MetricCard
              label="Median Age"
              value={formatDuration(data.medianAgeMs)}
              icon={Clock}
              color="text-blue-400"
              bg="bg-blue-500/10"
            />
            <MetricCard
              label="Average Age"
              value={formatDuration(data.averageAgeMs)}
              icon={Clock}
              color="text-purple-400"
              bg="bg-purple-500/10"
            />
          </div>

          {/* Aging Distribution */}
          <div>
            <h4 className="font-semibold mb-3">Aging Distribution</h4>
            <div className="space-y-2">
              {data.buckets.map((bucket, index) => {
                const percentage =
                  data.totalOpen > 0 ? (bucket.count / data.totalOpen) * 100 : 0;
                const isCritical = bucket.maxHours === null || bucket.minHours >= 72;
                const isWarning = bucket.minHours >= 24 && bucket.minHours < 72;

                return (
                  <div
                    key={bucket.label}
                    className="group relative overflow-hidden rounded-lg bg-white/[0.02] border border-white/5"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative flex items-center gap-4 p-3">
                      <div className="w-20 text-right text-xs text-foreground/50 font-mono">
                        {bucket.label}
                      </div>
                      <div className="flex-1 h-8 bg-white/5 rounded overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded transition-all duration-500",
                            isCritical && "bg-red-500",
                            isWarning && !isCritical && "bg-amber-500",
                            !isCritical && !isWarning && "bg-emerald-500"
                          )}
                          style={{ width: `${Math.max(percentage, bucket.count > 0 ? 2 : 0)}%` }}
                        />
                      </div>
                      <div className="w-16 text-right text-sm font-mono font-medium">
                        {bucket.count}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bucket Details Table */}
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02] border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 font-medium text-foreground/50">Bucket</th>
                  <th className="px-4 py-3 font-medium text-foreground/50">Range (hours)</th>
                  <th className="px-4 py-3 font-medium text-foreground/50 text-right">Count</th>
                  <th className="px-4 py-3 font-medium text-foreground/50 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.buckets.map((bucket) => {
                  const percentage =
                    data.totalOpen > 0 ? ((bucket.count / data.totalOpen) * 100).toFixed(1) : "0.0";
                  return (
                    <tr key={bucket.label} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{bucket.label}</td>
                      <td className="px-4 py-3 text-foreground/50 font-mono">
                        {bucket.minHours}h – {bucket.maxHours ? `${bucket.maxHours}h` : "∞"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium">
                        {bucket.count}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground/50">{percentage}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof Clock;
  color: string;
  bg: string;
}

function MetricCard({ label, value, icon: Icon, color, bg }: MetricCardProps) {
  return (
    <div className={cn("p-4 rounded-xl border", bg, "border-white/5")}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-4 h-4", color)} />
        <span className="text-xs text-foreground/50">{label}</span>
      </div>
      <p className={cn("font-mono font-bold text-lg", color)}>{value}</p>
    </div>
  );
}