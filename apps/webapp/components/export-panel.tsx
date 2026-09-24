"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Download, Plus } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import ExportRequestDialog from "./export-request-dialog";
import ExportJobsList from "./export-jobs-list";
import { ExportStatus, ExportType } from "@/types/export";

interface ExportPanelProps {
  onJobsUpdate?: (pendingExports: ExportType[]) => void;
}

export default function ExportPanel({ onJobsUpdate }: ExportPanelProps) {
  const { publicKey } = useStellarWallet();
  const [token, setToken] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [jobs, setJobs] = useState<any[]>([]);

  // Get token from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    setToken(storedToken);
  }, []);

  // Track pending exports (PENDING or PROCESSING status)
  const pendingExports = useMemo<ExportType[]>(() => {
    return jobs
      .filter((job) => job.status === ExportStatus.PENDING || job.status === ExportStatus.PROCESSING)
      .map((job) => job.type);
  }, [jobs]);

  // Callback from ExportJobsList to track jobs
  const handleJobsLoaded = useCallback((loadedJobs: any[]) => {
    setJobs(loadedJobs);
    onJobsUpdate?.(
      loadedJobs
        .filter((job) => job.status === ExportStatus.PENDING || job.status === ExportStatus.PROCESSING)
        .map((job) => job.type)
    );
  }, [onJobsUpdate]);

  const handleExportCreated = () => {
    // Trigger refresh of the jobs list
    setRefreshTrigger((prev) => prev + 1);
  };

  if (!token || !publicKey) {
    return (
      <div className="p-6 bg-gray-900/50 backdrop-blur-sm rounded-xl border border-white/10">
        <h2 className="text-xl font-semibold mb-4">Export Data</h2>
        <p className="text-gray-400 text-sm">Please log in and connect your wallet to request exports.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-900/50 backdrop-blur-sm rounded-xl border border-white/10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export Data
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Request and download your portfolio or transaction data
          </p>
        </div>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Request Export
        </button>
      </div>

      <ExportJobsList
        token={token}
        refreshTrigger={refreshTrigger}
        onJobsLoaded={handleJobsLoaded}
      />

      <ExportRequestDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onExportCreated={handleExportCreated}
        token={token}
        pendingExports={pendingExports}
      />
    </div>
  );
}
