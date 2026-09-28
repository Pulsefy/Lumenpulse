"use client";

import { Download, RefreshCw, Loader2, FileText } from 'lucide-react';
import { useState } from 'react';
import { ExportActionDialog } from './ExportActionDialog';
import { ExportJobList } from './ExportJobList';
import { useExports } from '@/hooks/useExports';
import { cn } from '@/lib/utils';

export function ExportsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { jobs, isLoading, error, refresh, requestExport, downloadExport, isPolling } = useExports();

  const pendingCount = jobs.filter((j) => j.status === 'pending' || j.status === 'processing').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Data Exports</h1>
            <p className="text-lg text-gray-400 mt-1">
              Request and manage your data exports. Files are generated asynchronously.
            </p>
          </div>

          <ExportActionDialog
            isOpen={dialogOpen}
            onOpenChange={setDialogOpen}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900/50 backdrop-blur-sm p-4 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 text-amber-400 mb-1">
              <Loader2 className="w-5 h-5" />
              <span className="font-medium">Processing</span>
            </div>
            <p className="text-2xl font-bold">{pendingCount}</p>
            <p className="text-sm text-gray-500">Exports in progress</p>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-sm p-4 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <FileText className="w-5 h-5" />
              <span className="font-medium">Completed</span>
            </div>
            <p className="text-2xl font-bold">{completedCount}</p>
            <p className="text-sm text-gray-500">Ready to download</p>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-sm p-4 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 text-rose-400 mb-1">
              <FileText className="w-5 h-5" />
              <span className="font-medium">Failed</span>
            </div>
            <p className="text-2xl font-bold">{failedCount}</p>
            <p className="text-sm text-gray-500">Requires retry</p>
          </div>
        </div>

        <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <h2 className="text-xl font-semibold">Export History</h2>
            <div className="flex items-center gap-2">
              {isPolling && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Polling...</span>
                </span>
              )}
              <button
                onClick={refresh}
                disabled={isLoading}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                  'bg-white/5 text-foreground/80 border-white/10 hover:bg-white/10 hover:text-foreground',
                  isLoading && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="p-4">
            <ExportJobList
              jobs={jobs}
              isLoading={isLoading}
              error={error}
              onDownload={downloadExport}
              onRefresh={refresh}
            />
          </div>
        </div>
      </div>
    </div>
  );
}