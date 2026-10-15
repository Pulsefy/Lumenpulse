"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { ExportApiService, ExportJobResponse, ExportType } from '@/lib/api-services';
import { useToast } from './use-toast';

const POLLING_INTERVAL_MS = 3000;
const MAX_POLLING_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export interface UseExportsState {
  jobs: ExportJobResponse[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  requestExport: (type: ExportType) => Promise<ExportJobResponse | null>;
  downloadExport: (jobId: string) => Promise<void>;
  isPolling: boolean;
}

export function useExports(): UseExportsState {
  const [jobs, setJobs] = useState<ExportJobResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const { toast } = useToast();

  const pollingJobsRef = useRef<Set<string>>(new Set());
  const pollingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pollingStartTimesRef = useRef<Map<string, number>>(new Map());

  const fetchJobs = useCallback(async () => {
    if (!ExportApiService.isAuthenticated()) {
      setJobs([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await ExportApiService.listJobs();
      setJobs(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load exports';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      const startTime = pollingStartTimesRef.current.get(jobId) ?? Date.now();
      pollingStartTimesRef.current.set(jobId, startTime);

      try {
        const job = await ExportApiService.getJob(jobId);

        // Update job in state
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? job : j))
        );

        // Check if job reached terminal state
        if (job.status === 'completed' || job.status === 'failed') {
          // Stop polling
          const timeout = pollingTimeoutsRef.current.get(jobId);
          if (timeout) {
            clearTimeout(timeout);
            pollingTimeoutsRef.current.delete(jobId);
          }
          pollingJobsRef.current.delete(jobId);
          pollingStartTimesRef.current.delete(jobId);

          if (job.status === 'completed') {
            toast({
              title: 'Export ready',
              description: `${job.type.replace(/_/g, ' ')} export completed. Click to download.`,
              variant: 'default',
            });
          } else {
            toast({
              title: 'Export failed',
              description: `${job.type.replace(/_/g, ' ')} export failed.`,
              variant: 'destructive',
            });
          }

          setIsPolling(pollingJobsRef.current.size > 0);
          return;
        }

        // Check max polling duration
        if (Date.now() - startTime > MAX_POLLING_DURATION_MS) {
          const timeout = pollingTimeoutsRef.current.get(jobId);
          if (timeout) {
            clearTimeout(timeout);
            pollingTimeoutsRef.current.delete(jobId);
          }
          pollingJobsRef.current.delete(jobId);
          pollingStartTimesRef.current.delete(jobId);
          setIsPolling(pollingJobsRef.current.size > 0);
          return;
        }

        // Schedule next poll
        const timeout = setTimeout(() => pollJob(jobId), POLLING_INTERVAL_MS);
        pollingTimeoutsRef.current.set(jobId, timeout);
      } catch (err) {
        console.error(`Polling failed for job ${jobId}:`, err);
        // Stop polling on error
        const timeout = pollingTimeoutsRef.current.get(jobId);
        if (timeout) {
          clearTimeout(timeout);
          pollingTimeoutsRef.current.delete(jobId);
        }
        pollingJobsRef.current.delete(jobId);
        pollingStartTimesRef.current.delete(jobId);
        setIsPolling(pollingJobsRef.current.size > 0);
      }
    },
    [toast]
  );

  const requestExport = useCallback(
    async (type: ExportType): Promise<ExportJobResponse | null> => {
      // Check for pending job of same type
      const existingPending = jobs.find(
        (j) => j.type === type && (j.status === 'pending' || j.status === 'processing')
      );
      if (existingPending) {
        toast({
          title: 'Export already in progress',
          description: `A ${type.replace(/_/g, ' ')} export is already ${existingPending.status}.`,
          variant: 'default',
        });
        return null;
      }

      try {
        const job = await ExportApiService.createJob(type);
        setJobs((prev) => [job, ...prev]);

        // Start polling
        pollingJobsRef.current.add(job.id);
        pollingStartTimesRef.current.set(job.id, Date.now());
        setIsPolling(true);
        pollJob(job.id);

        toast({
          title: 'Export requested',
          description: `${type.replace(/_/g, ' ')} export queued. You'll be notified when ready.`,
          variant: 'default',
        });

        return job;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to request export';
        toast({
          title: 'Export failed',
          description: message,
          variant: 'destructive',
        });
        return null;
      }
    },
    [jobs, toast, pollJob]
  );

  const downloadExport = useCallback(
    async (jobId: string) => {
      try {
        const blob = await ExportApiService.downloadJob(jobId);
        const job = jobs.find((j) => j.id === jobId);
        const filename = job
          ? `${job.type}_${new Date(job.createdAt).toISOString().split('T')[0]}.csv`
          : `export_${jobId}.csv`;

        // Create download link and trigger it
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast({
          title: 'Download started',
          description: 'Your export file is downloading.',
          variant: 'default',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download export';
        toast({
          title: 'Download failed',
          description: message,
          variant: 'destructive',
        });
      }
    },
    [jobs, toast]
  );

  const refresh = useCallback(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Initial fetch
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pollingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      pollingTimeoutsRef.current.clear();
      pollingJobsRef.current.clear();
      pollingStartTimesRef.current.clear();
    };
  }, []);

  return {
    jobs,
    isLoading,
    error,
    refresh,
    requestExport,
    downloadExport,
    isPolling,
  };
}