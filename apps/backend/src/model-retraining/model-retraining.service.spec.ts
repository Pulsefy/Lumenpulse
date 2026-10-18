import { Test, TestingModule } from '@nestjs/testing';
import { DataProcessingClient } from '../data-processing/data-processing.client';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import {
  ModelRetrainingService,
  JobSubmission,
  JobStatus,
  ModelStatusResult,
} from './model-retraining.service';
import { RequestContextService } from '../common/services/request-context.service';

describe('ModelRetrainingService', () => {
  let service: ModelRetrainingService;
  let httpService: jest.Mocked<Pick<DataProcessingClient, 'post' | 'get'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PYTHON_API_URL') return 'http://localhost:8000';
        if (key === 'PYTHON_API_KEY') return 'test-key';
        return undefined;
      }),
    } as unknown as jest.Mocked<Pick<ConfigService, 'get'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRetrainingService,
        { provide: DataProcessingClient, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ModelRetrainingService>(ModelRetrainingService);
  });

  describe('triggerRetraining', () => {
    it('submits to python /retrain and returns the job immediately', async () => {
      const submission: JobSubmission = {
        job_id: 'job-1',
        job_type: 'retrain',
        status: 'queued',
        created: true,
      };

      (httpService.post as jest.Mock).mockReturnValue(of({ data: submission }));

      const result = await service.triggerRetraining(true);

      expect(result).toEqual(submission);
      expect(httpService.post).toHaveBeenCalledWith(
        '/retrain',
        { force: true },
        {},
      );
    });

    it('delegates retraining within an active request context', async () => {
      const submission: JobSubmission = {
        job_id: 'job-corr',
        job_type: 'retrain',
        status: 'queued',
        created: true,
      };
      (httpService.post as jest.Mock).mockReturnValue(of({ data: submission }));

      await RequestContextService.run(
        { correlationId: 'corr-retrain-999' },
        async () => {
          await service.triggerRetraining(false);
        },
      );

      expect(httpService.post).toHaveBeenCalledWith(
        '/retrain',
        { force: false },
        {},
      );
    });

    it('propagates error when request fails', async () => {
      const error = new AxiosError('Network Error');
      (httpService.post as jest.Mock).mockReturnValue(throwError(() => error));

      await expect(service.triggerRetraining()).rejects.toThrow(
        'Network Error',
      );
    });
  });

  describe('getJobStatus', () => {
    it('calls python /api/jobs/{jobId} using a relative path', async () => {
      const jobStatus: JobStatus = {
        job_id: 'job-1',
        job_type: 'retrain',
        status: 'succeeded',
        result: { status: 'completed', duration_seconds: 12.5 },
      };
      (httpService.get as jest.Mock).mockReturnValue(of({ data: jobStatus }));

      const result = await service.getJobStatus('job-1');

      expect(result).toEqual(jobStatus);
      expect(httpService.get).toHaveBeenCalledWith('/api/jobs/job-1', {});
    });
  });

  describe('triggerRetrainingAndWait', () => {
    it('submits then polls until the job succeeds', async () => {
      const submission: JobSubmission = {
        job_id: 'job-2',
        job_type: 'retrain',
        status: 'queued',
        created: true,
      };
      (httpService.post as jest.Mock).mockReturnValue(of({ data: submission }));

      const running: JobStatus = {
        job_id: 'job-2',
        job_type: 'retrain',
        status: 'running',
      };
      const succeeded: JobStatus = {
        job_id: 'job-2',
        job_type: 'retrain',
        status: 'succeeded',
        result: { status: 'completed', duration_seconds: 42 },
      };
      (httpService.get as jest.Mock)
        .mockReturnValueOnce(of({ data: running }))
        .mockReturnValueOnce(of({ data: succeeded }));

      const result = await service.triggerRetrainingAndWait(false, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      });

      expect(result).toEqual({ status: 'completed', duration_seconds: 42 });
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('returns a failed result when the job fails', async () => {
      const submission: JobSubmission = {
        job_id: 'job-3',
        job_type: 'retrain',
        status: 'queued',
        created: true,
      };
      (httpService.post as jest.Mock).mockReturnValue(of({ data: submission }));

      const failed: JobStatus = {
        job_id: 'job-3',
        job_type: 'retrain',
        status: 'failed',
        error: 'quality gate failed',
      };
      (httpService.get as jest.Mock).mockReturnValue(of({ data: failed }));

      const result = await service.triggerRetrainingAndWait(false, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      });

      expect(result).toEqual({
        status: 'failed',
        error: 'quality gate failed',
      });
    });

    it('throws if the job does not finish before the timeout', async () => {
      const submission: JobSubmission = {
        job_id: 'job-4',
        job_type: 'retrain',
        status: 'queued',
        created: true,
      };
      (httpService.post as jest.Mock).mockReturnValue(of({ data: submission }));

      const running: JobStatus = {
        job_id: 'job-4',
        job_type: 'retrain',
        status: 'running',
      };
      (httpService.get as jest.Mock).mockReturnValue(of({ data: running }));

      await expect(
        service.triggerRetrainingAndWait(false, {
          pollIntervalMs: 1,
          timeoutMs: 5,
        }),
      ).rejects.toThrow(/did not finish within/);
    });
  });

  describe('getModelStatus', () => {
    it('calls python /model/status using a relative path', async () => {
      const mockStatus: ModelStatusResult = {
        last_run: { status: 'success' },
        registry: { active_version: 'v1.0' },
      };

      (httpService.get as jest.Mock).mockReturnValue(of({ data: mockStatus }));

      const result = await service.getModelStatus();

      expect(result).toEqual(mockStatus);
      expect(httpService.get).toHaveBeenCalledWith('/model/status', {});
    });
  });
});
