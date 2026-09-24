"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw, AlertCircle, CheckCircle, Clock, Loader } from "lucide-react";
import { ExportJob, ExportStatus, ExportType } from "@/types/export";
import { ExportApiService } from "@/lib/export-service";

interface ExportJobsListProps {
  token: string;
  refreshTrigger: number;
  onJobsLoaded?: (jobs: ExportJob[]) => void;
}

const STATUS_CONFIG = {
  [ExportStatus.PENDING]: {
    label: "Pending",
    icon: Clock,
    bgColor: "bg-gray-500/10",
    textColor: "text-gray-400",
    borderColor: "border-gray-500/30",
  },
  [ExportStatus.PROCESSING]: {
    label: "Processing",
    icon: Loader,
    bgColor: "bg-blue-500/10",
    textColor: "text-blue-400",
    borderColor: "border-blue-500/30",
  },
  [ExportStatus.COMPLETED]: {
    label: "Completed",
    icon: CheckCircle,
    bgColor: "bg-green-500/10",
    textColor: "text-green-400",
    borderColor: "border-green-500/30",
  },
  [ExportStatus.FAILED]: {
    label: "Failed",
    icon: AlertCircle,
    bgColor: "bg-red-500/10",
    textColor: "text-red-400",
    borderColor: "border-red-500/30",
  },
};

const EXPORT_TYPE_LABELS = {
  [ExportType.PORTFOLIO_HISTORY]: "Portfolio History",
  [ExportType.TAX_TRANSACTIONS]: "Tax Transactions",
};

const POLL_INTERVAL = 3000; // 3 seconds
const MAX_POLL_TIME = 5 * 60 * 1000; // 5 minutes

export default function ExportJobsList({ token, refreshTrigger, onJobsLoaded }: ExportJobsListProps) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // Track when each job started polling
  const [pollStartTimes] = useState<Map<string, number>>(new Map());

  const fetchJobs = useCallback(async () => {
    try {
      const data = await ExportApiService.listExportJobs(token);
      setJobs(data);
      onJobsLoaded?.(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch exports";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [token, onJobsLoaded]);

  // Initial fetch
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshTrigger]);

  // Polling for active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (job) => job.status === ExportStatus.PENDING || job.status === ExportStatus.PROCESSING
    );

    if (!hasActiveJobs) return;

    const pollInterval = setInterval(async () => {
      try {
        const data = await ExportApiService.listExportJobs(token);
        setJobs(data);
        onJobsLoaded?.(data);
      } catch (err) {
        console.error("Failed to poll export jobs:", err);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(pollInterval);
  }, [jobs, token, onJobsLoaded]);

  const handleDownload = async (job: ExportJob) => {
    if (job.status !== ExportStatus.COMPLETED) return;

    setDownloadingIds((prev) => new Set(prev).add(job.id));

    try {
      const blob = await ExportApiService.downloadExportJob(job.id, token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const timestamp = new Date(job.createdAt).toISOString().split("T")[0];
      const filename = `${job.type}_${timestamp}.csv`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download export:", err);
      alert("Failed to download file. Please try again.");
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="w-5 h-5 text-blue-400 animate-spin" />
        <span className="ml-2 text-gray-400">Loading exports...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-400">Failed to load exports</h3>
            <p className="text-red-400/80 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-8">
        <Download className="w-8 h-8 text-gray-500 mx-auto mb-2 opacity-50" />
        <p className="text-gray-400">No exports yet. Request one to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const statusConfig = STATUS_CONFIG[job.status];
        const StatusIcon = statusConfig.icon;
        const isCompleted = job.status === ExportStatus.COMPLETED;
        const isFailed = job.status === ExportStatus.FAILED;
        const isDownloading = downloadingIds.has(job.id);

        return (
          <div
            key={job.id}
            className={`p-4 border rounded-lg transition-all ${statusConfig.borderColor} ${statusConfig.bgColor}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <StatusIcon className={`w-5 h-5 flex-shrink-0 ${statusConfig.textColor} ${
                  job.status === ExportStatus.PROCESSING ? "animate-spin" : ""
                }`} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white truncate">
                    {EXPORT_TYPE_LABELS[job.type]}
                  </h3>
                  <p className={`text-xs ${statusConfig.textColor} truncate`}>
                    {statusConfig.label} • {formatDate(job.createdAt)}
                  </p>
                  {isFailed && job.errorMessage && (
                    <p className="text-xs text-red-400 mt-1 truncate">
                      Error: {job.errorMessage}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {isCompleted && (
                  <button
                    onClick={() => handleDownload(job)}
                    disabled={isDownloading}
                    className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
                      isDownloading
                        ? "bg-gray-500/20 text-gray-400 cursor-not-allowed"
                        : "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                    }`}
                    title="Download CSV"
                  >
                    {isDownloading ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
