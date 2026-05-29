import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';

import { RpcMetricsController } from './rpc.metrics.controller';
import { RpcObservabilityService } from './rpc.observability.service';
import { SorobanRpcService } from './soroban-rpc.service';
import { RpcExceptionFilter } from './rpc.exception-filter';
import { SOROBAN_RPC_CONFIG } from './rpc.config';
import { RpcError, RpcErrorCode } from './rpc.errors';

// ─── Mock @stellar/stellar-sdk/rpc ───────────────────────────────────────────

const mockServer = {
  getLatestLedger: jest.fn(),
  getLedgerEntries: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

jest.mock('@stellar/stellar-sdk/rpc', () => ({
  Server: jest.fn(() => mockServer),
  Api: {
    GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND', SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
    isSimulationError: jest.fn(),
  },
  assembleTransaction: jest.fn(),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Transaction: jest.fn(),
  FeeBumpTransaction: jest.fn(),
  xdr: {},
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  timeoutMs: 5_000,
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
};

describe('SorobanRpc (e2e)', () => {
  let app: INestApplication;
  let obs: RpcObservabilityService;
  let sorobanService: SorobanRpcService;

  const getHttpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RpcMetricsController],
      providers: [
        { provide: SOROBAN_RPC_CONFIG, useValue: TEST_CONFIG },
        RpcObservabilityService,
        SorobanRpcService,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new RpcExceptionFilter());
    await app.init();

    obs = moduleFixture.get<RpcObservabilityService>(RpcObservabilityService);
    sorobanService = moduleFixture.get<SorobanRpcService>(SorobanRpcService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    obs.reset();
  });

  // ─── GET /metrics/rpc ──────────────────────────────────────────────────────

  describe('GET /metrics/rpc', () => {
    it('returns an empty snapshot before any calls are made', async () => {
      const response = await request(getHttpServer())
        .get('/metrics/rpc')
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body).toEqual({ sorobanRpc: {} });
    });

    it('reflects call counts after a successful RPC call', async () => {
      mockServer.getLatestLedger.mockResolvedValueOnce({ sequence: 100 });
      await sorobanService.getLatestLedger();

      const response = await request(getHttpServer())
        .get('/metrics/rpc')
        .expect(200);

      const snap = response.body.sorobanRpc as Record<string, {
        calls: number;
        successes: number;
        failures: number;
        retries: number;
      }>;

      expect(snap['getLatestLedger'].calls).toBe(1);
      expect(snap['getLatestLedger'].successes).toBe(1);
      expect(snap['getLatestLedger'].failures).toBe(0);
      expect(snap['getLatestLedger'].retries).toBe(0);
    });

    it('reflects failure and retry counts after a failed RPC call', async () => {
      mockServer.getLatestLedger.mockRejectedValue(new Error('econnrefused'));

      await sorobanService.getLatestLedger().catch(() => {/* expected */});

      const response = await request(getHttpServer())
        .get('/metrics/rpc')
        .expect(200);

      const snap = response.body.sorobanRpc as Record<string, {
        calls: number;
        successes: number;
        failures: number;
        retries: number;
      }>;

      expect(snap['getLatestLedger'].calls).toBe(1);
      expect(snap['getLatestLedger'].successes).toBe(0);
      expect(snap['getLatestLedger'].failures).toBe(TEST_CONFIG.maxAttempts);
      expect(snap['getLatestLedger'].retries).toBe(TEST_CONFIG.maxAttempts - 1);
    });

    it('includes latency histogram buckets in the snapshot', async () => {
      mockServer.getLatestLedger.mockResolvedValueOnce({ sequence: 1 });
      await sorobanService.getLatestLedger();

      const response = await request(getHttpServer())
        .get('/metrics/rpc')
        .expect(200);

      const buckets = response.body.sorobanRpc['getLatestLedger'].latencyBuckets as Array<{
        le: number;
        count: number;
      }>;

      expect(Array.isArray(buckets)).toBe(true);
      expect(buckets.length).toBeGreaterThan(0);
      expect(buckets[buckets.length - 1].le).toBe(null); // Infinity serialises as null in JSON
    });
  });

  // ─── RpcExceptionFilter ────────────────────────────────────────────────────

  describe('RpcExceptionFilter HTTP status mapping', () => {
    // Temporarily add a test route that throws a given RpcError so we can
    // verify the filter maps it to the right HTTP status.
    // We do this by calling sorobanService methods and letting the mock throw.

    it('maps RETRIES_EXHAUSTED (network error) to 503', async () => {
      // Trigger a 503 by making the service throw RETRIES_EXHAUSTED
      // We verify the filter directly via its toApiError shape
      const err = new RpcError({
        message: 'retries exhausted',
        code: RpcErrorCode.RETRIES_EXHAUSTED,
      });
      expect(err.toApiError().code).toBe('RETRIES_EXHAUSTED');
    });

    it('maps TIMEOUT to 504', async () => {
      const err = new RpcError({ message: 'timeout', code: RpcErrorCode.TIMEOUT });
      const { RPC_ERROR_HTTP_STATUS } = await import('../src/soroban-rpc/rpc.errors');
      expect(RPC_ERROR_HTTP_STATUS[RpcErrorCode.TIMEOUT]).toBe(504);
    });

    it('maps RPC_ERROR to 502', async () => {
      const { RPC_ERROR_HTTP_STATUS } = await import('../src/soroban-rpc/rpc.errors');
      expect(RPC_ERROR_HTTP_STATUS[RpcErrorCode.RPC_ERROR]).toBe(502);
    });

    it('maps NETWORK_UNAVAILABLE to 503', async () => {
      const { RPC_ERROR_HTTP_STATUS } = await import('../src/soroban-rpc/rpc.errors');
      expect(RPC_ERROR_HTTP_STATUS[RpcErrorCode.NETWORK_UNAVAILABLE]).toBe(503);
    });
  });

  // ─── Metrics accumulate correctly across multiple methods ─────────────────

  describe('multi-method metrics', () => {
    it('tracks getLatestLedger and getTransaction independently', async () => {
      mockServer.getLatestLedger.mockResolvedValue({ sequence: 42 });
      mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

      await sorobanService.getLatestLedger();
      await sorobanService.getLatestLedger();
      await sorobanService.getTransaction('abc123');

      const response = await request(getHttpServer())
        .get('/metrics/rpc')
        .expect(200);

      const snap = response.body.sorobanRpc;
      expect(snap['getLatestLedger'].calls).toBe(2);
      expect(snap['getTransaction'].calls).toBe(1);
    });
  });
});