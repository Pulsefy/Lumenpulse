import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { StellarService } from '../stellar/stellar.service';
import { HealthService } from './health.service';
import { LatencyBudgetHealthService } from './latency-budget.health.service';

describe('HealthService', () => {
  let service: HealthService;
  let dataSource: { query: jest.Mock };
  let cacheService: { checkHealth: jest.Mock };
  let stellarService: { checkHealth: jest.Mock };
  let httpService: { get: jest.Mock };
  let latencyBudgetHealthService: {
    getLatencyBudgetReport: jest.Mock;
  };

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

  const okLatencyReport = {
    overallState: 'ok' as const,
    checkedAt: new Date().toISOString(),
    dependencies: [],
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
    latencyBudgetHealthService = {
      getLatencyBudgetReport: jest.fn().mockResolvedValue(okLatencyReport),
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
        {
          provide: LatencyBudgetHealthService,
          useValue: latencyBudgetHealthService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();

    // Re-apply the default latency mock after clearAllMocks
    latencyBudgetHealthService.getLatencyBudgetReport.mockResolvedValue(
      okLatencyReport,
    );
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
    expect(report.latencyBudget).toBeDefined();
    expect(report.latencyBudget.overallState).toBe('ok');
  });

  it('returns degraded when a non-critical dependency fails', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(false);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: { ok: true } }));

    const report = await service.getHealthReport();

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.error!.redis).toEqual({
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
    expect(report.error!.database).toEqual({
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
    expect(report.error!.externalApis).toEqual(
      expect.objectContaining({
        status: 'down',
        message: 'One or more external APIs are unavailable',
      }),
    );
  });

  // ── Latency budget integration ─────────────────────────────────────────────

  it('returns status=error and summary=down when latency is hard_down', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(true);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: {} }));
    latencyBudgetHealthService.getLatencyBudgetReport.mockResolvedValue({
      overallState: 'hard_down',
      checkedAt: new Date().toISOString(),
      dependencies: [],
    });

    const report = await service.getHealthReport();

    expect(report.status).toBe('error');
    expect(report.summary).toBe('down');
    expect(report.latencyBudget.overallState).toBe('hard_down');
  });

  it('returns status=ok and summary=degraded when latency is degraded', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    cacheService.checkHealth.mockResolvedValue(true);
    stellarService.checkHealth.mockResolvedValue(true);
    httpService.get.mockReturnValue(of({ data: {} }));
    latencyBudgetHealthService.getLatencyBudgetReport.mockResolvedValue({
      overallState: 'degraded',
      checkedAt: new Date().toISOString(),
      dependencies: [],
    });

    const report = await service.getHealthReport();

    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.latencyBudget.overallState).toBe('degraded');
  });
});
