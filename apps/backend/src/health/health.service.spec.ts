import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { HealthService } from './health.service';
import { LatencyBudgetHealthService } from './latency-budget.health.service';

describe('HealthService', () => {
  let service: HealthService;
  const database = { query: jest.fn() };
  const cache = { checkHealth: jest.fn() };
  const http = { get: jest.fn() };
  const latency = { getLatencyBudgetReport: jest.fn() };
  const budget = (
    horizon: 'ok' | 'degraded' | 'hard_down' = 'ok',
    rpc: 'ok' | 'degraded' | 'hard_down' = 'ok',
  ) => ({
    overallState:
      horizon === 'hard_down' || rpc === 'hard_down'
        ? 'hard_down'
        : horizon === 'degraded' || rpc === 'degraded'
          ? 'degraded'
          : 'ok',
    checkedAt: '2026-09-25T00:00:00.000Z',
    dependencies: [
      {
        name: 'horizon',
        state: horizon,
        latencyMs: 10,
        url: '',
        thresholds: { degradedMs: 1000, hardDownMs: 4000 },
      },
      {
        name: 'sorobanRpc',
        state: rpc,
        latencyMs: 20,
        url: '',
        thresholds: { degradedMs: 1500, hardDownMs: 5000 },
      },
    ],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    database.query.mockResolvedValue([{ '?column?': 1 }]);
    cache.checkHealth.mockResolvedValue(true);
    http.get.mockReturnValue(of({ data: { status: 'healthy' } }));
    latency.getLatencyBudgetReport.mockResolvedValue(budget());
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getDataSourceToken(), useValue: database },
        { provide: CacheService, useValue: cache },
        { provide: HttpService, useValue: http },
        { provide: LatencyBudgetHealthService, useValue: latency },
      ],
    }).compile();
    service = module.get(HealthService);
  });

  it('reports every dependency with status and latency', async () => {
    const report = await service.getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.summary).toBe('healthy');
    for (const name of [
      'database',
      'redis',
      'horizon',
      'sorobanRpc',
      'python',
      'coinGecko',
      'exchangeRateApi',
    ]) {
      expect(report.dependencies[name]).toEqual(
        expect.objectContaining({
          status: 'up',
          latencyMs: expect.any(Number),
        }),
      );
    }
    expect(http.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.any(Object),
    );
  });

  it('marks Redis and Python failures as degraded without failing readiness', async () => {
    cache.checkHealth.mockResolvedValue(false);
    http.get.mockImplementation((url: string) =>
      url.endsWith('/health')
        ? throwError(() => new Error('unavailable'))
        : of({ data: {} }),
    );
    const report = await service.getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.dependencies.redis.status).toBe('down');
    expect(report.dependencies.python.status).toBe('down');
  });

  it('fails readiness when Postgres or Soroban RPC is down', async () => {
    database.query.mockRejectedValue(new Error('database unavailable'));
    latency.getLatencyBudgetReport.mockResolvedValue(budget('ok', 'hard_down'));
    const report = await service.getHealthReport();
    expect(report.status).toBe('error');
    expect(report.summary).toBe('down');
    expect(report.dependencies.database.status).toBe('down');
    expect(report.dependencies.sorobanRpc.status).toBe('down');
  });

  it('marks slow but reachable Horizon as degraded', async () => {
    latency.getLatencyBudgetReport.mockResolvedValue(budget('degraded'));
    const report = await service.getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.summary).toBe('degraded');
    expect(report.dependencies.horizon.status).toBe('up');
  });

  it('fails readiness when Horizon is down', async () => {
    latency.getLatencyBudgetReport.mockResolvedValue(budget('hard_down'));
    const report = await service.getHealthReport();
    expect(report.status).toBe('error');
    expect(report.dependencies.horizon.status).toBe('down');
  });

  it('reports both network probes as down if the budget service fails', async () => {
    latency.getLatencyBudgetReport.mockRejectedValue(
      new Error('probe failure'),
    );
    const report = await service.getHealthReport();
    expect(report.status).toBe('error');
    expect(report.dependencies.horizon.status).toBe('down');
    expect(report.dependencies.sorobanRpc.status).toBe('down');
  });

  it('times out an individual hanging dependency', async () => {
    jest.useFakeTimers();
    try {
      cache.checkHealth.mockReturnValue(new Promise(() => undefined));
      const reportPromise = service.getHealthReport();
      await jest.advanceTimersByTimeAsync(3000);
      const report = await reportPromise;
      expect(report.dependencies.redis).toEqual(
        expect.objectContaining({
          status: 'down',
          latencyMs: 3000,
          message: 'redis timed out',
        }),
      );
      expect(report.status).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });
});
