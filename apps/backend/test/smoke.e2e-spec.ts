import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { SmokeEndpointService } from '../src/health/smoke-endpoint.service';
import { SmokeEndpointReport } from '../src/health/smoke-endpoint.dto';

describe('Smoke Endpoint (e2e)', () => {
  let app: INestApplication;
  let smokeEndpointService: { getSmokeReport: jest.Mock };

  const getHttpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    smokeEndpointService = {
      getSmokeReport: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getHealthReport: jest.fn(),
          },
        },
        {
          provide: require('../src/health/contract-health.service').ContractHealthService,
          useValue: {
            getContractHealthReport: jest.fn(),
          },
        },
        {
          provide: SmokeEndpointService,
          useValue: smokeEndpointService,
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

  it('GET /smoke returns ok status when all checks pass', async () => {
    const report: SmokeEndpointReport = {
      status: 'ok',
      network: 'testnet',
      checkedAt: new Date().toISOString(),
      envVars: [
        { name: 'STELLAR_NETWORK', configured: true, value: 'testnet' },
        { name: 'STELLAR_HORIZON_URL', configured: true, value: 'https://horizon-testnet.stellar.org' },
        { name: 'STELLAR_SOROBAN_RPC_URL', configured: true, value: 'https://soroban-testnet.stellar.org' },
        { name: 'STELLAR_SERVER_SECRET', configured: true, value: '[REDACTED]' },
      ],
      contracts: [
        { name: 'lumenToken', envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN', configured: true, status: 'reachable', contractId: 'CDLZF...T7GY6' },
      ],
    };

    smokeEndpointService.getSmokeReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/smoke')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = response.body as SmokeEndpointReport;

    expect(body.status).toBe('ok');
    expect(body.envVars).toHaveLength(4);
    expect(body.contracts).toBeDefined();
  });

  it('returns 503 when env vars are missing', async () => {
    const report: SmokeEndpointReport = {
      status: 'error',
      network: 'testnet',
      checkedAt: new Date().toISOString(),
      envVars: [
        { name: 'STELLAR_NETWORK', configured: true, value: 'testnet' },
        { name: 'STELLAR_HORIZON_URL', configured: true, value: 'https://horizon-testnet.stellar.org' },
        { name: 'STELLAR_SOROBAN_RPC_URL', configured: false },
        { name: 'STELLAR_SERVER_SECRET', configured: false },
      ],
      contracts: [],
    };

    smokeEndpointService.getSmokeReport.mockResolvedValue(report);

    await request(getHttpServer())
      .get('/smoke')
      .expect(503);
  });

  it('returns 503 when contracts are misconfigured', async () => {
    const report: SmokeEndpointReport = {
      status: 'error',
      network: 'testnet',
      checkedAt: new Date().toISOString(),
      envVars: [
        { name: 'STELLAR_NETWORK', configured: true, value: 'testnet' },
        { name: 'STELLAR_HORIZON_URL', configured: true },
        { name: 'STELLAR_SOROBAN_RPC_URL', configured: true },
        { name: 'STELLAR_SERVER_SECRET', configured: true, value: '[REDACTED]' },
      ],
      contracts: [
        { name: 'lumenToken', envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN', configured: false, status: 'misconfigured' },
      ],
    };

    smokeEndpointService.getSmokeReport.mockResolvedValue(report);

    await request(getHttpServer())
      .get('/smoke')
      .expect(503);
  });

  it('does not expose secrets in response', async () => {
    const report: SmokeEndpointReport = {
      status: 'ok',
      network: 'testnet',
      checkedAt: new Date().toISOString(),
      envVars: [
        { name: 'STELLAR_NETWORK', configured: true, value: 'testnet' },
        { name: 'STELLAR_HORIZON_URL', configured: true, value: 'https://horizon-testnet.stellar.org' },
        { name: 'STELLAR_SOROBAN_RPC_URL', configured: true },
        { name: 'STELLAR_SERVER_SECRET', configured: true, value: '[REDACTED]' },
      ],
      contracts: [],
    };

    smokeEndpointService.getSmokeReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/smoke')
      .expect(200);

    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toMatch(/[A-Z0-9]{56}/);
  });

  it('returns machine-readable status for CI consumption', async () => {
    const report: SmokeEndpointReport = {
      status: 'ok',
      network: 'testnet',
      checkedAt: '2024-01-15T10:30:00.000Z',
      envVars: [
        { name: 'STELLAR_NETWORK', configured: true, value: 'testnet' },
        { name: 'STELLAR_HORIZON_URL', configured: true, value: 'https://horizon-testnet.stellar.org' },
        { name: 'STELLAR_SOROBAN_RPC_URL', configured: true },
        { name: 'STELLAR_SERVER_SECRET', configured: true, value: '[REDACTED]' },
      ],
      contracts: [],
    };

    smokeEndpointService.getSmokeReport.mockResolvedValue(report);

    const response = await request(getHttpServer())
      .get('/smoke')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.network).toBe('testnet');
    expect(typeof response.body.checkedAt).toBe('string');
    expect(Array.isArray(response.body.envVars)).toBe(true);
    expect(Array.isArray(response.body.contracts)).toBe(true);
  });
});