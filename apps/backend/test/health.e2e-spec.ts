import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import {
  HealthService,
  LumenpulseHealthReport,
} from '../src/health/health.service';

describe('Health Check (e2e)', () => {
  let app: INestApplication;
  let healthService: { getHealthReport: jest.Mock };

  const getHttpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    healthService = {
      getHealthReport: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthService,
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
    const report: LumenpulseHealthReport = {
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
    };

    healthService.getHealthReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = response.body as LumenpulseHealthReport;

    expect(body).toEqual(report);
  });

  it('keeps the API up when a non-critical dependency is down', async () => {
    const report: LumenpulseHealthReport = {
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
    };

    healthService.getHealthReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = response.body as LumenpulseHealthReport;

    expect(body.status).toBe('ok');
    expect(body.summary).toBe('degraded');
    expect(body.error.redis.status).toBe('down');
  });

  it('returns 503 when the database is down', async () => {
    const report: LumenpulseHealthReport = {
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
    };

    healthService.getHealthReport.mockResolvedValue(report);

    await request(getHttpServer()).get('/health').expect(503);
  });
});
