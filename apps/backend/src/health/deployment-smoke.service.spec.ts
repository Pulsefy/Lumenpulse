jest.mock('../lib/config', () => ({
  config: {
    nodeEnv: 'test',
    stellar: { network: 'testnet' },
  },
}));

import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../cache/cache.service';
import { StellarService } from '../stellar/stellar.service';
import { ContractHealthService } from './contract-health.service';
import { DeploymentSmokeService } from './deployment-smoke.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require('../lib/config');

const REQUIRED_ENV = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'lumenpulse',
  DB_PASSWORD: 'super-secret-password',
  DB_DATABASE: 'lumenpulse',
  PORT: '3000',
  JWT_SECRET: 'super-secret-jwt',
  STELLAR_SERVER_SECRET: 'SBSECRETSECRETSECRET',
  CORS_ORIGIN: 'http://localhost:3000',
  PYTHON_API_URL: 'http://localhost:8000',
};

describe('DeploymentSmokeService', () => {
  let service: DeploymentSmokeService;
  let dataSource: { query: jest.Mock };
  let cacheService: { checkHealth: jest.Mock };
  let stellarService: { checkHealth: jest.Mock };
  let contractHealthService: { getContractHealthReport: jest.Mock };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = process.env;
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    config.nodeEnv = 'test';
    config.stellar.network = 'testnet';

    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    cacheService = { checkHealth: jest.fn().mockResolvedValue(true) };
    stellarService = { checkHealth: jest.fn().mockResolvedValue(true) };
    contractHealthService = {
      getContractHealthReport: jest.fn().mockResolvedValue({
        contracts: [
          {
            name: 'lumenToken',
            envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
            status: 'reachable',
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentSmokeService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: CacheService, useValue: cacheService },
        { provide: StellarService, useValue: stellarService },
        { provide: ContractHealthService, useValue: contractHealthService },
      ],
    }).compile();

    service = module.get(DeploymentSmokeService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('passes when config, dependencies and contracts are all healthy', async () => {
    const report = await service.getSmokeReport();

    expect(report.status).toBe('pass');
    expect(report.ready).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.network).toBe('testnet');
    expect(report.checks.map((check) => check.id)).toContain(
      'contract.lumenToken',
    );
  });

  it('fails when a required environment variable is missing', async () => {
    delete process.env.JWT_SECRET;

    const report = await service.getSmokeReport();

    expect(report.status).toBe('fail');
    expect(report.ready).toBe(false);
    expect(
      report.checks.find((check) => check.id === 'env.JWT_SECRET'),
    ).toMatchObject({ status: 'fail' });
  });

  it('accepts DB_NAME as the DB_DATABASE fallback', async () => {
    delete process.env.DB_DATABASE;
    process.env.DB_NAME = 'lumenpulse';

    const report = await service.getSmokeReport();

    expect(
      report.checks.find((check) => check.id === 'env.DB_DATABASE'),
    ).toMatchObject({ status: 'pass' });
  });

  it('treats a conditional variable as a warning when it is not required', async () => {
    delete process.env.PYTHON_API_URL;
    config.nodeEnv = 'test';

    const report = await service.getSmokeReport();

    expect(
      report.checks.find((check) => check.id === 'env.PYTHON_API_URL'),
    ).toMatchObject({ status: 'warn' });
    expect(report.status).toBe('warn');
    expect(report.ready).toBe(true);
  });

  it('treats a conditional variable as a failure when its condition holds', async () => {
    delete process.env.CORS_ORIGIN;
    config.nodeEnv = 'production';

    const report = await service.getSmokeReport();

    expect(
      report.checks.find((check) => check.id === 'env.CORS_ORIGIN'),
    ).toMatchObject({ status: 'fail' });
    expect(report.ready).toBe(false);
  });

  it('never echoes an environment variable value', async () => {
    const report = await service.getSmokeReport();
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(REQUIRED_ENV.DB_PASSWORD);
    expect(serialized).not.toContain(REQUIRED_ENV.JWT_SECRET);
    expect(serialized).not.toContain(REQUIRED_ENV.STELLAR_SERVER_SECRET);
  });

  it('reports a fixed message instead of the driver error when the database is down', async () => {
    dataSource.query.mockRejectedValue(
      new Error(
        'connect ECONNREFUSED postgres://lumenpulse:super-secret-password@10.0.0.4:5432',
      ),
    );

    const report = await service.getSmokeReport();
    const check = report.checks.find(
      (entry) => entry.id === 'dependency.database',
    );

    expect(check).toMatchObject({
      status: 'fail',
      message: 'Database is unreachable',
    });
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
    expect(report.ready).toBe(false);
  });

  it('degrades rather than fails when only Redis is unavailable', async () => {
    cacheService.checkHealth.mockResolvedValue(false);

    const report = await service.getSmokeReport();

    expect(report.status).toBe('warn');
    expect(report.ready).toBe(true);
  });

  it('fails when Horizon is unreachable', async () => {
    stellarService.checkHealth.mockResolvedValue(false);

    const report = await service.getSmokeReport();

    expect(report.ready).toBe(false);
    expect(
      report.checks.find((check) => check.id === 'dependency.horizon'),
    ).toMatchObject({ status: 'fail' });
  });

  it('fails when a contract ID is misconfigured, naming the env var to fix', async () => {
    contractHealthService.getContractHealthReport.mockResolvedValue({
      contracts: [
        {
          name: 'treasury',
          envVar: 'STELLAR_CONTRACT_TREASURY',
          status: 'misconfigured',
        },
      ],
    });

    const report = await service.getSmokeReport();
    const check = report.checks.find(
      (entry) => entry.id === 'contract.treasury',
    );

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('STELLAR_CONTRACT_TREASURY');
    expect(report.ready).toBe(false);
  });

  it('fails closed when the contract report itself throws', async () => {
    contractHealthService.getContractHealthReport.mockRejectedValue(
      new Error('soroban rpc exploded'),
    );

    const report = await service.getSmokeReport();

    expect(report.ready).toBe(false);
    expect(
      report.checks.find((check) => check.id === 'contract.report'),
    ).toMatchObject({ status: 'fail' });
    expect(JSON.stringify(report)).not.toContain('soroban rpc exploded');
  });
});
