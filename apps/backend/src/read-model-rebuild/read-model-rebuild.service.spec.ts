import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { ReadModelRebuildService } from './read-model-rebuild.service';
import {
  ReadModelRebuildJob,
  RebuildStatus,
  RebuildDataset,
} from './entities/read-model-rebuild-job.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';

describe('ReadModelRebuildService', () => {
  let service: ReadModelRebuildService;
  let httpService: jest.Mocked<Pick<HttpService, 'post'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let jobRepo: {
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
  };
  let jobLockService: {
    tryAcquire: jest.Mock;
    release: jest.Mock;
  };
  let jobHistoryService: {
    start: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
  };
  let adminAuditService: {
    create: jest.Mock;
  };

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
    } as unknown as jest.Mocked<Pick<HttpService, 'post'>>;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PYTHON_API_URL') return 'http://localhost:8000';
        if (key === 'PYTHON_API_KEY') return 'test-key';
        return undefined;
      }),
    } as unknown as jest.Mocked<Pick<ConfigService, 'get'>>;

    jobRepo = {
      save: jest
        .fn()
        .mockImplementation((job: ReadModelRebuildJob) => Promise.resolve(job)),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(
          (job: Partial<ReadModelRebuildJob>): ReadModelRebuildJob =>
            job as ReadModelRebuildJob,
        ),
    };

    jobLockService = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };

    jobHistoryService = {
      start: jest.fn().mockResolvedValue({ id: 'hist-1' }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    adminAuditService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadModelRebuildService,
        {
          provide: getRepositoryToken(ReadModelRebuildJob),
          useValue: jobRepo,
        },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
        { provide: JobLockService, useValue: jobLockService },
        { provide: JobHistoryService, useValue: jobHistoryService },
        { provide: AdminAuditService, useValue: adminAuditService },
      ],
    }).compile();

    service = module.get<ReadModelRebuildService>(ReadModelRebuildService);
  });

  it('uses configured PYTHON_API_URL and PYTHON_API_KEY for rebuild requests', async () => {
    const job = new ReadModelRebuildJob();
    job.id = 'job-123';
    job.dataset = RebuildDataset.KPI_SNAPSHOTS;
    job.status = RebuildStatus.PENDING;

    (httpService.post as jest.Mock).mockReturnValue(
      of({
        data: {
          totalItems: 10,
          processedItems: 10,
          failedItems: 0,
        },
      }),
    );

    await (service as any).executeRebuild(job, 'user-1');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/rebuild/kpi-snapshots',
      { dataset: RebuildDataset.KPI_SNAPSHOTS, force: true },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Key': 'test-key',
          'X-Correlation-ID': 'rebuild-job-123',
        }),
      }),
    );
    expect(job.status).toBe(RebuildStatus.COMPLETED);
    expect(job.processedItems).toBe(10);
  });
});
