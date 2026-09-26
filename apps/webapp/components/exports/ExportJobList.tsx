"use client";

import { Download, Loader2, AlertCircle, CheckCircle, XCircle, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExportJobResponse, ExportStatus } from '@/lib/api-services';

interface ExportJobListProps {
  jobs: ExportJobResponse[];
  isLoading: boolean;
  error: string | null;
  onDownload: (jobId: string) => void;
  onRefresh: () => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getStatusConfig(status: ExportStatus) {
  switch (status) {
    case 'completed':
      return {
        label: 'Completed',
        icon: CheckCircle,
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10 border-emerald-500/20',
        iconBg: 'bg-emerald-500/10',
      };
    case 'failed':
      return {
        label: 'Failed',
        icon: XCircle,
        color: 'text-rose-400',
        bgColor: 'bg-rose-500/10 border-rose-500/20',
        iconBg: 'bg-rose-500/10',
      };
    case 'processing':
      return {
        label: 'Processing',
        icon: Loader2,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10 border-blue-500/20',
        iconBg: 'bg-blue-500/10',
      };
    case 'pending':
      return {
        label: 'Pending',
        icon: Clock,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10 border-amber-500/20',
        iconBg: 'bg-amber-500/10',
      };
    default:
      return {
        label: status,
        icon: FileText,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/10 border-gray-500/20',
        iconBg: 'bg-gray-500/10',
      };
  }
}

function getTypeLabel(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function ExportJobList({
  jobs,
  isLoading,
  error,
  onDownload,
  onRefresh,
}: ExportJobListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.01] animate-pulse">
            <div className="w-8 h-8 rounded-full bg-white/5" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 bg-white/5 rounded" />
              <div className="h-3 w-1/4 bg-white/5 rounded" />
            </div>
            <div className="h-6 w-16 bg-white/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <h3 className="text-sm font-semibold text-foreground/70 mb-1">Failed to load exports</h3>
        <p className="text-sm text-foreground/40 max-w-sm leading-relaxed mb-4">{error}</p>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 text-foreground/60 text-sm font-semibold rounded-lg border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
        >
          <Loader2 className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center mb-4">
          <FileText className="w-7 h-7 text-foreground/30" />
        </div>
        <h3 className="text-base font-semibold text-foreground/70 mb-1">No exports yet</h3>
        <p className="text-sm text-foreground/40 max-w-sm leading-relaxed">
          Request an export to see it appear here. Exports are processed asynchronously.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const statusConfig = getStatusConfig(job.status);
        const StatusIcon = statusConfig.icon;
        const isTerminal = job.status === 'completed' || job.status === 'failed';
        const isProcessing = job.status === 'pending' || job.status === 'processing';

        return (
          <div
            key={job.id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border transition-all duration-200',
              'hover:bg-white/[0.03]',
              statusConfig.bgColor,
              isTerminal && 'opacity-80'
            )}
          >
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center border', statusConfig.iconBg)}>
              <StatusIcon className={cn('w-4 h-4', statusConfig.color)} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-white truncate">{getTypeLabel(job.type)}</p>
                <span
                  className={cn(
                    'px-2 py-0.5 text-xs font-medium rounded-full border',
                    statusConfig.color.replace('text-', 'bg-').replace('400', '500/20'),
                    statusConfig.color.replace('text-', 'text-'),
                    statusConfig.color.replace('text-', 'border-').replace('400', '500/30')
                  )}
                >
                  {statusConfig.label}
                </span>
              </div>
              <p className="text-xs text-foreground/40 mt-0.5">
                Created {formatDate(job.createdAt)}
                {job.updatedAt !== job.createdAt && ` • Updated ${formatDate(job.updatedAt)}`}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isProcessing && (
                <div className="flex items-center gap-2 text-xs text-foreground/40">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>Processing...</span>
                </div>
              )}
              {job.status === 'completed' && (
                <button
                  onClick={() => onDownload(job.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium rounded-lg border border-primary/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              )}
              {job.status === 'failed' && (
                <span className="px-3 py-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                  Failed
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}