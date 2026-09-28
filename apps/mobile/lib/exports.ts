import { Platform, Share } from 'react-native';
import { apiClient, ApiResponse } from './api-client';

export type ExportType =
  | 'portfolio_history'
  | 'tax_transactions'
  | 'onchain_analytics'
  | 'round_analytics';

export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

export interface ExportJob {
  id: string;
  type: ExportType;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
}

export interface ExportOption {
  type: ExportType;
  titleKey: string;
  descKey: string;
  icon: string;
}

export const EXPORT_OPTIONS: ExportOption[] = [
  {
    type: 'tax_transactions',
    titleKey: 'settings.exports.tax_transactions',
    descKey: 'settings.exports.tax_transactions_desc',
    icon: 'receipt-outline',
  },
  {
    type: 'portfolio_history',
    titleKey: 'settings.exports.portfolio_history',
    descKey: 'settings.exports.portfolio_history_desc',
    icon: 'pie-chart-outline',
  },
];

/** Exports are considered expired after 24 hours */
export const EXPORT_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Check if an export job is expired (either explicitly marked or older than 24h).
 */
export function isExportExpired(job: ExportJob): boolean {
  if (job.status === 'expired') return true;
  if (job.status === 'completed') {
    const createdTime = new Date(job.createdAt).getTime();
    if (!isNaN(createdTime) && Date.now() - createdTime > EXPORT_EXPIRY_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the effective display status for an export job,
 * accounting for expiration.
 */
export function getExportDisplayStatus(job: ExportJob): ExportStatus {
  if (isExportExpired(job)) return 'expired';
  return job.status;
}

/**
 * Format standard filename for downloaded export file.
 */
export function getExportFilename(job: ExportJob): string {
  const dateStr = new Date(job.createdAt).toISOString().split('T')[0] || 'export';
  return `${job.type}_${dateStr}.csv`;
}

/**
 * Export API service communicating with backend /exports endpoints.
 */
export const exportApi = {
  /**
   * Request a new async export job (POST /exports)
   */
  async createJob(type: ExportType): Promise<ApiResponse<ExportJob>> {
    return apiClient.post<ExportJob>('/exports', { type });
  },

  /**
   * List recent export jobs for the authenticated user (GET /exports)
   */
  async listJobs(): Promise<ApiResponse<ExportJob[]>> {
    return apiClient.get<ExportJob[]>('/exports');
  },

  /**
   * Get the current status of an export job (GET /exports/:id)
   */
  async getJob(id: string): Promise<ApiResponse<ExportJob>> {
    return apiClient.get<ExportJob>(`/exports/${id}`);
  },

  /**
   * Download the CSV file for a completed export job (GET /exports/:id/download)
   */
  async downloadJob(id: string): Promise<ApiResponse<string>> {
    return apiClient.getText(`/exports/${id}/download`, {
      headers: {
        Accept: 'text/csv, text/plain, */*',
      },
    });
  },
};

/**
 * Download and present the resulting export file via the system share sheet.
 * On Web: uses Web Share API if supported, or creates an automatic blob download link.
 * On Native (iOS/Android): invokes React Native's system Share sheet.
 */
export async function shareExportFile(job: ExportJob, csvContent: string): Promise<boolean> {
  const filename = getExportFilename(job);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    // Attempt Web Share API first
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
      try {
        const file = new File([csvContent], filename, { type: 'text/csv' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: filename,
            files: [file],
          });
          return true;
        }
      } catch {
        // Fallback to direct blob download link
      }
    }

    // Direct browser download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }

  // Native mobile system share sheet
  try {
    const result = await Share.share(
      {
        title: filename,
        message: csvContent,
      },
      {
        dialogTitle: `Share ${filename}`,
        subject: filename,
      },
    );
    return result.action !== Share.dismissedAction;
  } catch (error) {
    console.error('Failed to open system share sheet:', error);
    return false;
  }
}

/**
 * Manager handling export lifecycle: polling, duplicate prevention, and download flow.
 */
export class ExportManager {
  private pollingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private pollingStartTimes = new Map<string, number>();
  private activeJobIds = new Set<string>();
  private pollIntervalMs: number;
  private maxPollDurationMs: number;

  constructor(options?: { pollIntervalMs?: number; maxPollDurationMs?: number }) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 3000;
    this.maxPollDurationMs = options?.maxPollDurationMs ?? 5 * 60 * 1000;
  }

  /**
   * Check whether an export type already has an active pending or processing job.
   * Prevents duplicate requests.
   */
  isTypePending(type: ExportType, jobs: ExportJob[]): boolean {
    return jobs.some(
      (job) => job.type === type && (job.status === 'pending' || job.status === 'processing'),
    );
  }

  /**
   * Request an export job, enforcing duplicate prevention.
   */
  async requestExport(
    type: ExportType,
    currentJobs: ExportJob[],
  ): Promise<{ job: ExportJob | null; error?: string }> {
    if (this.isTypePending(type, currentJobs)) {
      return {
        job: null,
        error: 'An export for this data is already in progress. Please wait for it to complete.',
      };
    }

    const response = await exportApi.createJob(type);
    if (!response.success || !response.data) {
      return {
        job: null,
        error: response.error?.message || 'Failed to request export job',
      };
    }

    return { job: response.data };
  }

  /**
   * Poll an individual job until it reaches a terminal state (completed/failed/expired)
   * or exceeds max duration.
   */
  pollJob(
    jobId: string,
    callbacks: {
      onUpdate: (job: ExportJob) => void;
      onComplete?: (job: ExportJob) => void;
      onFail?: (job: ExportJob) => void;
      onError?: (err: unknown) => void;
    },
  ): void {
    if (this.activeJobIds.has(jobId)) return;
    this.activeJobIds.add(jobId);
    this.pollingStartTimes.set(jobId, Date.now());

    const tick = async () => {
      const startTime = this.pollingStartTimes.get(jobId) || Date.now();
      if (Date.now() - startTime > this.maxPollDurationMs) {
        this.stopPolling(jobId);
        return;
      }

      try {
        const response = await exportApi.getJob(jobId);
        if (response.success && response.data) {
          const job = response.data;
          callbacks.onUpdate(job);

          if (job.status === 'completed') {
            this.stopPolling(jobId);
            callbacks.onComplete?.(job);
            return;
          }

          if (job.status === 'failed') {
            this.stopPolling(jobId);
            callbacks.onFail?.(job);
            return;
          }
        }
      } catch (err) {
        callbacks.onError?.(err);
      }

      if (this.activeJobIds.has(jobId)) {
        const timeout = setTimeout(tick, this.pollIntervalMs);
        this.pollingTimeouts.set(jobId, timeout);
      }
    };

    void tick();
  }

  stopPolling(jobId: string): void {
    const timeout = this.pollingTimeouts.get(jobId);
    if (timeout) {
      clearTimeout(timeout);
      this.pollingTimeouts.delete(jobId);
    }
    this.pollingStartTimes.delete(jobId);
    this.activeJobIds.delete(jobId);
  }

  stopAll(): void {
    this.pollingTimeouts.forEach((t) => clearTimeout(t));
    this.pollingTimeouts.clear();
    this.pollingStartTimes.clear();
    this.activeJobIds.clear();
  }

  getActiveCount(): number {
    return this.activeJobIds.size;
  }

  isPolling(jobId: string): boolean {
    return this.activeJobIds.has(jobId);
  }

  /**
   * Download a completed export and present it via the system share sheet.
   */
  async downloadAndShare(job: ExportJob): Promise<{ success: boolean; error?: string }> {
    if (isExportExpired(job)) {
      return { success: false, error: 'This export has expired and cannot be downloaded.' };
    }

    if (job.status !== 'completed') {
      return { success: false, error: 'Export is not yet ready for download.' };
    }

    const response = await exportApi.downloadJob(job.id);
    if (!response.success || typeof response.data !== 'string') {
      return { success: false, error: response.error?.message || 'Failed to download export file' };
    }

    const shared = await shareExportFile(job, response.data);
    return { success: shared };
  }
}

export const exportManager = new ExportManager();
