import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import {
  ExportJob,
  ExportType,
  exportApi,
  exportManager,
  getExportDisplayStatus,
} from '../lib/exports';

export interface UseExportsReturn {
  jobs: ExportJob[];
  isLoading: boolean;
  isPolling: boolean;
  downloadingId: string | null;
  requestingType: ExportType | null;
  error: string | null;
  refresh: () => Promise<void>;
  requestExport: (type: ExportType) => Promise<ExportJob | null>;
  downloadExport: (jobId: string) => Promise<boolean>;
  isTypePending: (type: ExportType) => boolean;
}

export function useExports(): UseExportsReturn {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [requestingType, setRequestingType] = useState<ExportType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  /**
   * Helper to check if an export of the given type is currently pending or processing.
   * Prevents duplicate requests.
   */
  const isTypePending = useCallback(
    (type: ExportType): boolean => {
      return exportManager.isTypePending(type, jobs);
    },
    [jobs],
  );

  /**
   * Poll an individual job until it reaches a terminal status.
   */
  const pollJob = useCallback((jobId: string) => {
    setIsPolling(true);
    exportManager.pollJob(jobId, {
      onUpdate: (updatedJob) => {
        setJobs((prevJobs) => {
          const index = prevJobs.findIndex((j) => j.id === jobId);
          if (index >= 0) {
            const next = [...prevJobs];
            next[index] = updatedJob;
            return next;
          }
          return [updatedJob, ...prevJobs];
        });
      },
      onComplete: () => {
        setIsPolling(exportManager.getActiveCount() > 0);
      },
      onFail: () => {
        setIsPolling(exportManager.getActiveCount() > 0);
      },
      onError: (err) => {
        console.warn(`Polling error for job ${jobId}:`, err);
      },
    });
  }, []);

  /**
   * Fetch recent jobs from backend and start polling any that are in pending/processing status.
   */
  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await exportApi.listJobs();
      if (response.success && response.data) {
        const fetchedJobs = response.data;
        setJobs(fetchedJobs);

        // Resume/start polling for any job that is pending or processing
        fetchedJobs.forEach((job) => {
          if (
            (job.status === 'pending' || job.status === 'processing') &&
            !exportManager.isPolling(job.id)
          ) {
            pollJob(job.id);
          }
        });
      } else {
        setError(response.error?.message || 'Failed to load exports');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exports');
    } finally {
      setIsLoading(false);
    }
  }, [pollJob]);

  /**
   * Request a new export.
   * Duplicate prevention is enforced: returns null if an export of that type is already in progress.
   */
  const requestExport = useCallback(
    async (type: ExportType): Promise<ExportJob | null> => {
      setRequestingType(type);
      try {
        const result = await exportManager.requestExport(type, jobs);
        if (!result.job) {
          Alert.alert('Export Notice', result.error || 'Failed to request export');
          return null;
        }

        const newJob = result.job;
        setJobs((prev) => [newJob, ...prev.filter((j) => j.id !== newJob.id)]);
        pollJob(newJob.id);

        return newJob;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to request export';
        Alert.alert('Export Failed', msg);
        return null;
      } finally {
        setRequestingType(null);
      }
    },
    [jobs, pollJob],
  );

  /**
   * Download a completed export and trigger system share sheet.
   */
  const downloadExport = useCallback(
    async (jobId: string): Promise<boolean> => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        Alert.alert('Error', 'Export job not found.');
        return false;
      }

      if (getExportDisplayStatus(job) === 'expired') {
        Alert.alert('Export Expired', 'This export has expired and is no longer available.');
        return false;
      }

      setDownloadingId(jobId);
      try {
        const result = await exportManager.downloadAndShare(job);
        if (!result.success) {
          Alert.alert('Download Error', result.error || 'Failed to download or share export file.');
          return false;
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to download export file';
        Alert.alert('Download Error', msg);
        return false;
      } finally {
        setDownloadingId(null);
      }
    },
    [jobs],
  );

  /**
   * AppState listener to handle backgrounding during jobs:
   * When app returns to foreground ('active' from 'background' / 'inactive'),
   * immediately re-fetch and check pending jobs.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (previousState.match(/inactive|background/) && nextAppState === 'active') {
        // App has returned to foreground!
        // Immediately fetch updated job statuses to capture any completions during background.
        void fetchJobs();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [fetchJobs]);

  /**
   * Initial fetch on mount
   */
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  /**
   * Stop polling on unmount
   */
  useEffect(() => {
    return () => {
      exportManager.stopAll();
    };
  }, []);

  return {
    jobs,
    isLoading,
    isPolling,
    downloadingId,
    requestingType,
    error,
    refresh: fetchJobs,
    requestExport,
    downloadExport,
    isTypePending,
  };
}
