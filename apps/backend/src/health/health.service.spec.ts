import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { StellarService } from '../stellar/stellar.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let dataSource: { query: jest.Mock };
  let cacheService: { checkHealth: jest.Mock };
  let stellarService: { checkHealth: jest.Mock };
  let httpService: { get: jest.Mock };

  const mockHealthIndicatorService = {
    check: jest.fn((key: string) => ({
      up: (data: Record<string, unknown> = {}) => ({
        [key]: { status: 'up', ...data },
      }),
      down: (data: Record<string, unknown> = {}) => ({
        [key]: { status: 'down', ...data },
      }),
    })),
  };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn(),
    };
    cacheService = {
      checkHealth: jest.fn(),
    };
    stellarService = {
      checkHealth: jest.fn(),
    };
    httpService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: HealthIndicatorService,
          useValue: mockHealthIndicatorService,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
        {
          provide: CacheService,
          useValue: cacheService,
        },
        {
          provide: StellarService,
          useValue: stellarService,
        },
        {
          provide: HttpService,
          useValue: httpService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
  });

  it('returns healthy when all critical and non-critical checks pass', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(true);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: { ok: true } }));

    const report = await service.getHealthReport();

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('healthy');
    expect(report.details.database.status).toBe('up');
    expect(report.details.redis.status).toBe('up');
    expect(report.details.horizon.status).toBe('up');
    expect(report.details.externalApis.status).toBe('up');
  });

  it('returns degraded when a non-critical dependency fails', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(false);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: { ok: true } }));

    const report = await service.getHealthReport();

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.error.redis).toEqual({
      status: 'down',
      message: 'Redis cache is unavailable',
    });
  });

  it('returns down when the database check fails', async () => {
    dataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED'));
    cacheService.checkHealth.mockResolvedValue(true);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: { ok: true } }));

    const report = await service.getHealthReport();

    expect(report.status).toBe('error');
    expect(report.summary).toBe('down');
    expect(report.error.database).toEqual({
      status: 'down',
      message: 'connect ECONNREFUSED',
    });
  });

  it('reports external APIs as down when their checks fail', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(true);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockImplementationOnce(() =>
      throwError(() => new Error('CoinGecko timeout')),
    );
    httpService.get.mockImplementationOnce(() =>
      throwError(() => new Error('ExchangeRate timeout')),
    );

    const report = await service.getHealthReport();

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.error.externalApis).toEqual(
      expect.objectContaining({
        status: 'down',
        message: 'One or more external APIs are unavailable',
      }),
    );
  });
});
