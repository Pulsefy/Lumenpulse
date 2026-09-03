import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { ContractHealthService } from '../src/health/contract-health.service';
import { DeploymentSmokeService } from '../src/health/deployment-smoke.service';
import { HealthController } from '../src/health/health.controller';
import {
  HealthService,
  LumenpulseHealthReport,
} from '../src/health/health.service';
import { ShutdownService } from '../src/health/shutdown.service';

describe('Health Check (e2e)', () => {
  let app: INestApplication;
  let healthService: { getHealthReport: jest.Mock };
  let contractHealthService: { getContractHealthReport: jest.Mock };
  let deploymentSmokeService: { getSmokeReport: jest.Mock };
  let shutdownService: { isShuttingDown: jest.Mock };

  const getHttpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    healthService = {
      getHealthReport: jest.fn(),
    };
    contractHealthService = {
      getContractHealthReport: jest.fn(),
    };
    deploymentSmokeService = {
      getSmokeReport: jest.fn(),
    };
    shutdownService = {
      isShuttingDown: jest.fn().mockReturnValue(false),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthService,
        },
        {
          provide: ContractHealthService,
          useValue: contractHealthService,
        },
        {
          provide: DeploymentSmokeService,
          useValue: deploymentSmokeService,
        },
        {
          provide: ShutdownService,
          useValue: shutdownService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /health returns dependency statuses when all checks are up', async () => {
    // FIXED: Safely cast via unknown to bypass schema differences with LatencyBudgetReport fields
    const report = {
      status: 'ok',
      summary: 'healthy',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
        horizon: { status: 'up' },
        externalApis: { status: 'up' },
      },
      error: {},
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
        horizon: { status: 'up' },
        externalApis: { status: 'up' },
      },
      latencyBudget: {
        used: 45,
        limit: 100,
      },
    } as unknown as LumenpulseHealthReport;

    healthService.getHealthReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = response.body as LumenpulseHealthReport;

    expect(body).toEqual(report);
  });

  it('keeps the API up when a non-critical dependency is down', async () => {
    // FIXED: Safely cast via unknown to bypass schema differences with LatencyBudgetReport fields
    const report = {
      status: 'ok',
      summary: 'degraded',
      info: {
        database: { status: 'up' },
      },
      error: {
        redis: {
          status: 'down',
          message: 'Redis cache is unavailable',
        },
      },
      details: {
        database: { status: 'up' },
        redis: {
          status: 'down',
          message: 'Redis cache is unavailable',
        },
        horizon: { status: 'up' },
        externalApis: { status: 'up' },
      },
      latencyBudget: {
        used: 35,
        limit: 100,
      },
    } as unknown as LumenpulseHealthReport;

    healthService.getHealthReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = response.body as LumenpulseHealthReport;

    expect(body.status).toBe('ok');
    expect(body.summary).toBe('degraded');
    expect(body.error!.redis!.status).toBe('down');
    expect(body.latencyBudget).toBeDefined();
  });

  it('returns 503 when the database is down', async () => {
    // FIXED: Safely cast via unknown to bypass schema differences with LatencyBudgetReport fields
    const report = {
      status: 'error',
      summary: 'down',
      info: {},
      error: {
        database: {
          status: 'down',
          message: 'Database is unavailable',
        },
      },
      details: {
        database: {
          status: 'down',
          message: 'Database is unavailable',
        },
        redis: { status: 'up' },
        horizon: { status: 'up' },
        externalApis: { status: 'up' },
      },
      latencyBudget: {
        used: 20,
        limit: 100,
      },
    } as unknown as LumenpulseHealthReport;

    healthService.getHealthReport.mockResolvedValue(report);

    await request(getHttpServer()).get('/health').expect(503);
  });

  describe('GET /health/smoke', () => {
    const passingReport = {
      status: 'pass',
      ready: true,
      checkedAt: '2026-08-29T00:00:00.000Z',
      durationMs: 42,
      network: 'testnet',
      environment: 'test',
      summary: { total: 2, passed: 2, warned: 0, failed: 0 },
      checks: [
        {
          id: 'env.JWT_SECRET',
          category: 'config',
          status: 'pass',
          message: 'JWT_SECRET is set',
        },
        {
          id: 'contract.lumenToken',
          category: 'contract',
          status: 'pass',
          message: 'lumenToken contract is reachable',
        },
      ],
    };

    it('returns 200 with a machine-readable report when everything is ready', async () => {
      deploymentSmokeService.getSmokeReport.mockResolvedValue(passingReport);

      const response = await request(getHttpServer())
        .get('/health/smoke')
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body).toEqual(passingReport);
    });

    it('returns 200 when only non-blocking warnings were raised', async () => {
      deploymentSmokeService.getSmokeReport.mockResolvedValue({
        ...passingReport,
        status: 'warn',
        summary: { total: 2, passed: 1, warned: 1, failed: 0 },
      });

      await request(getHttpServer()).get('/health/smoke').expect(200);
    });

    it('returns 503 when a check failed', async () => {
      deploymentSmokeService.getSmokeReport.mockResolvedValue({
        ...passingReport,
        status: 'fail',
        ready: false,
        summary: { total: 2, passed: 1, warned: 0, failed: 1 },
      });

      const response = await request(getHttpServer())
        .get('/health/smoke')
        .expect(503);

      expect((response.body as { ready: boolean }).ready).toBe(false);
    });
  });
});
