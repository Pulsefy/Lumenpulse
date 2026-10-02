import { Share } from 'react-native';
import {
  exportApi,
  isExportExpired,
  getExportDisplayStatus,
  getExportFilename,
  shareExportFile,
  ExportJob,
  EXPORT_EXPIRY_MS,
  ExportManager,
  exportManager,
} from '../exports';
import { apiClient } from '../api-client';

describe('Exports Module (lib/exports.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isExportExpired and getExportDisplayStatus', () => {
    it('identifies fresh pending and processing jobs correctly', () => {
      const pendingJob: ExportJob = {
        id: 'job-1',
        type: 'tax_transactions',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(pendingJob)).toBe(false);
      expect(getExportDisplayStatus(pendingJob)).toBe('pending');

      const processingJob: ExportJob = {
        id: 'job-2',
        type: 'portfolio_history',
        status: 'processing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(processingJob)).toBe(false);
      expect(getExportDisplayStatus(processingJob)).toBe('processing');
    });

    it('identifies completed jobs within 24 hours as completed', () => {
      const recentCompleted: ExportJob = {
        id: 'job-3',
        type: 'tax_transactions',
        status: 'completed',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(recentCompleted)).toBe(false);
      expect(getExportDisplayStatus(recentCompleted)).toBe('completed');
    });

    it('identifies completed jobs older than 24 hours as expired', () => {
      const oldCompleted: ExportJob = {
        id: 'job-4',
        type: 'portfolio_history',
        status: 'completed',
        createdAt: new Date(Date.now() - (EXPORT_EXPIRY_MS + 60000)).toISOString(), // 24h + 1min
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(oldCompleted)).toBe(true);
      expect(getExportDisplayStatus(oldCompleted)).toBe('expired');
    });

    it('identifies explicit expired status', () => {
      const explicitExpired: ExportJob = {
        id: 'job-5',
        type: 'tax_transactions',
        status: 'expired',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(explicitExpired)).toBe(true);
      expect(getExportDisplayStatus(explicitExpired)).toBe('expired');
    });

    it('identifies failed jobs and distinguishes them from pending and expired', () => {
      const failedJob: ExportJob = {
        id: 'job-6',
        type: 'tax_transactions',
        status: 'failed',
        errorMessage: 'Database timeout',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(isExportExpired(failedJob)).toBe(false);
      expect(getExportDisplayStatus(failedJob)).toBe('failed');

      // Ensure distinct statuses
      const pendingStatus = getExportDisplayStatus({ ...failedJob, status: 'pending' });
      const expiredStatus = getExportDisplayStatus({ ...failedJob, status: 'expired' });
      const failedStatus = getExportDisplayStatus(failedJob);

      expect(failedStatus).not.toEqual(pendingStatus);
      expect(failedStatus).not.toEqual(expiredStatus);
      expect(expiredStatus).not.toEqual(pendingStatus);
    });

    it('handles invalid dates gracefully in isExportExpired', () => {
      const invalidDateJob: ExportJob = {
        id: 'job-invalid',
        type: 'tax_transactions',
        status: 'completed',
        createdAt: 'invalid-date',
        updatedAt: 'invalid-date',
      };
      expect(isExportExpired(invalidDateJob)).toBe(false);
    });
  });

  describe('getExportFilename', () => {
    it('creates formatted filename with type and date', () => {
      const job: ExportJob = {
        id: 'test-id',
        type: 'tax_transactions',
        status: 'completed',
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:01:00.000Z',
      };
      expect(getExportFilename(job)).toBe('tax_transactions_2026-09-28.csv');
    });
  });

  describe('exportApi methods', () => {
    it('createJob sends POST request to /exports', async () => {
      const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValueOnce({
        success: true,
        data: {
          id: 'job-10',
          type: 'tax_transactions',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const res = await exportApi.createJob('tax_transactions');
      expect(postSpy).toHaveBeenCalledWith('/exports', { type: 'tax_transactions' });
      expect(res.success).toBe(true);
      expect(res.data?.id).toBe('job-10');
    });

    it('listJobs sends GET request to /exports', async () => {
      const getSpy = jest.spyOn(apiClient, 'get').mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const res = await exportApi.listJobs();
      expect(getSpy).toHaveBeenCalledWith('/exports');
      expect(res.success).toBe(true);
    });

    it('getJob sends GET request to /exports/:id', async () => {
      const getSpy = jest.spyOn(apiClient, 'get').mockResolvedValueOnce({
        success: true,
        data: {
          id: 'job-11',
          type: 'portfolio_history',
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const res = await exportApi.getJob('job-11');
      expect(getSpy).toHaveBeenCalledWith('/exports/job-11');
      expect(res.success).toBe(true);
    });

    it('downloadJob sends getText request to /exports/:id/download', async () => {
      const getTextSpy = jest.spyOn(apiClient, 'getText').mockResolvedValueOnce({
        success: true,
        data: 'id,date,amount\n1,2026-09-28,100',
      });

      const res = await exportApi.downloadJob('job-12');
      expect(getTextSpy).toHaveBeenCalledWith(
        '/exports/job-12/download',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: expect.stringContaining('text/csv'),
          }),
        }),
      );
      expect(res.success).toBe(true);
      expect(res.data).toContain('id,date,amount');
    });
  });

  describe('shareExportFile', () => {
    it('invokes native Share.share with filename and CSV content on mobile', async () => {
      const job: ExportJob = {
        id: 'job-13',
        type: 'tax_transactions',
        status: 'completed',
        createdAt: '2026-09-28T00:00:00.000Z',
        updatedAt: '2026-09-28T00:00:00.000Z',
      };
      const csv = 'header1,header2\nval1,val2';

      const result = await shareExportFile(job, csv);

      expect(Share.share).toHaveBeenCalledWith(
        {
          title: 'tax_transactions_2026-09-28.csv',
          message: csv,
        },
        expect.objectContaining({
          dialogTitle: 'Share tax_transactions_2026-09-28.csv',
        }),
      );
      expect(result).toBe(true);
    });

    it('handles Share.share failure gracefully', async () => {
      (Share.share as jest.Mock).mockRejectedValueOnce(new Error('Share cancelled or unavailable'));
      const job: ExportJob = {
        id: 'job-14',
        type: 'tax_transactions',
        status: 'completed',
        createdAt: '2026-09-28T00:00:00.000Z',
        updatedAt: '2026-09-28T00:00:00.000Z',
      };
      const result = await shareExportFile(job, 'data');
      expect(result).toBe(false);
    });
  });

  describe('ExportManager', () => {
    let manager: ExportManager;

    beforeEach(() => {
      manager = new ExportManager({ pollIntervalMs: 1000, maxPollDurationMs: 5000 });
    });

    afterEach(() => {
      manager.stopAll();
    });

    describe('Duplicate Prevention', () => {
      it('isTypePending returns true when matching type is pending or processing', () => {
        const jobs: ExportJob[] = [
          {
            id: 'job-1',
            type: 'tax_transactions',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'job-2',
            type: 'portfolio_history',
            status: 'completed',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

        expect(manager.isTypePending('tax_transactions', jobs)).toBe(true);
        expect(manager.isTypePending('portfolio_history', jobs)).toBe(false);
      });

      it('prevents requesting a duplicate export when one is already pending', async () => {
        const jobs: ExportJob[] = [
          {
            id: 'existing-pending',
            type: 'tax_transactions',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

        const postSpy = jest.spyOn(apiClient, 'post');

        const result = await manager.requestExport('tax_transactions', jobs);

        expect(result.job).toBeNull();
        expect(result.error).toContain('already in progress');
        expect(postSpy).not.toHaveBeenCalled();
      });

      it('allows requesting an export when none of that type is pending', async () => {
        const newJob: ExportJob = {
          id: 'new-job',
          type: 'tax_transactions',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        jest.spyOn(apiClient, 'post').mockResolvedValueOnce({
          success: true,
          data: newJob,
        });

        const result = await manager.requestExport('tax_transactions', []);

        expect(result.job).toEqual(newJob);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Job Polling', () => {
      it('polls job until completed and notifies callbacks', async () => {
        const onUpdate = jest.fn();
        const onComplete = jest.fn();
        const onFail = jest.fn();

        const pendingJob: ExportJob = {
          id: 'poll-1',
          type: 'portfolio_history',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const processingJob: ExportJob = {
          ...pendingJob,
          status: 'processing',
        };

        const completedJob: ExportJob = {
          ...pendingJob,
          status: 'completed',
        };

        const getJobSpy = jest
          .spyOn(exportApi, 'getJob')
          .mockResolvedValueOnce({ success: true, data: pendingJob })
          .mockResolvedValueOnce({ success: true, data: processingJob })
          .mockResolvedValueOnce({ success: true, data: completedJob });

        manager.pollJob('poll-1', { onUpdate, onComplete, onFail });

        expect(manager.isPolling('poll-1')).toBe(true);
        expect(manager.getActiveCount()).toBe(1);

        // Initial tick
        await Promise.resolve();
        expect(onUpdate).toHaveBeenCalledWith(pendingJob);

        // Advance 1st interval
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        expect(onUpdate).toHaveBeenCalledWith(processingJob);

        // Advance 2nd interval
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        expect(onUpdate).toHaveBeenCalledWith(completedJob);
        expect(onComplete).toHaveBeenCalledWith(completedJob);
        expect(onFail).not.toHaveBeenCalled();

        // Polling should have stopped automatically on completion
        expect(manager.isPolling('poll-1')).toBe(false);
        expect(manager.getActiveCount()).toBe(0);
      });

      it('polls job until failed and notifies onFail callback', async () => {
        const onUpdate = jest.fn();
        const onFail = jest.fn();

        const failedJob: ExportJob = {
          id: 'poll-2',
          type: 'tax_transactions',
          status: 'failed',
          errorMessage: 'Out of memory',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        jest.spyOn(exportApi, 'getJob').mockResolvedValueOnce({ success: true, data: failedJob });

        manager.pollJob('poll-2', { onUpdate, onFail });

        await Promise.resolve();
        expect(onUpdate).toHaveBeenCalledWith(failedJob);
        expect(onFail).toHaveBeenCalledWith(failedJob);
        expect(manager.isPolling('poll-2')).toBe(false);
      });

      it('stops polling when stopAll is called', () => {
        manager.pollJob('poll-3', { onUpdate: jest.fn() });
        expect(manager.getActiveCount()).toBe(1);

        manager.stopAll();
        expect(manager.getActiveCount()).toBe(0);
        expect(manager.isPolling('poll-3')).toBe(false);
      });
    });

    describe('downloadAndShare', () => {
      it('prevents downloading an expired export', async () => {
        const expiredJob: ExportJob = {
          id: 'exp-1',
          type: 'tax_transactions',
          status: 'completed',
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await manager.downloadAndShare(expiredJob);
        expect(result.success).toBe(false);
        expect(result.error).toContain('expired');
      });

      it('prevents downloading an incomplete export', async () => {
        const pendingJob: ExportJob = {
          id: 'pend-1',
          type: 'tax_transactions',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await manager.downloadAndShare(pendingJob);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not yet ready');
      });

      it('downloads and shares a valid completed export', async () => {
        const completedJob: ExportJob = {
          id: 'comp-1',
          type: 'tax_transactions',
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        jest.spyOn(exportApi, 'downloadJob').mockResolvedValueOnce({
          success: true,
          data: 'tx_id,amount\n1,50',
        });

        const result = await manager.downloadAndShare(completedJob);
        expect(result.success).toBe(true);
        expect(Share.share).toHaveBeenCalled();
      });
    });
  });
});
