import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  WebhookVerificationGuard,
  WEBHOOK_PROVIDER_KEY,
} from './webhook-verification.guard';
import { WebhookVerificationService } from './webhook-verification.service';
import { MetricsService } from '../metrics/metrics.service';

describe('WebhookVerificationGuard', () => {
  let guard: WebhookVerificationGuard;

  const testSecret = 'test-webhook-secret-12345';
  const testProvider = 'test-provider';

  const mockVerificationService = {
    verifySignature: jest.fn(),
    getProviderInfo: jest.fn(),
    getRegisteredProviders: jest.fn(),
    registerProvider: jest.fn(),
    onModuleInit: jest.fn(),
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
  };

  const mockReflector = {
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'WEBHOOK_TIMESTAMP_TOLERANCE_MS') return '300000';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookVerificationGuard,
        {
          provide: WebhookVerificationService,
          useValue: mockVerificationService,
        },
        { provide: Reflector, useValue: mockReflector },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    guard = module.get<WebhookVerificationGuard>(WebhookVerificationGuard);
  });

  afterEach(() => {
    // Clean up the interval timer
    (guard as any).cleanupTimer?.unref?.();
    clearInterval((guard as any).cleanupTimer);
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function generateValidSignature(
    body: Buffer,
    _timestamp: string,
    _nonce: string,
    secret: string = testSecret,
  ): string {
    // The guard computes HMAC over the raw body (not a constructed payload)
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  function createMockContext(
    overrides: {
      rawBody?: Buffer | 'MISSING';
      signature?: string;
      timestamp?: string;
      nonce?: string;
      providerName?: string;
      routePath?: string;
    } = {},
  ): ExecutionContext {
    const defaultBody = Buffer.from(
      '{"type":"anomaly","metric_name":"volume"}',
    );

    const headers: Record<string, string> = {};
    if (overrides.signature !== undefined) {
      headers['x-webhook-signature'] = overrides.signature;
    }
    if (overrides.timestamp !== undefined) {
      headers['x-webhook-timestamp'] = overrides.timestamp;
    }
    if (overrides.nonce !== undefined) {
      headers['x-webhook-nonce'] = overrides.nonce;
    }
    if (overrides.providerName !== undefined) {
      headers['x-webhook-provider'] = overrides.providerName;
    }

    // Build request, conditionally omitting rawBody to simulate missing body
    const mockRequest: Record<string, unknown> = {
      headers,
      query: {},
      method: 'POST',
      path: overrides.routePath ?? '/webhooks/data-processing',
      route: { path: overrides.routePath ?? '/webhooks/data-processing' },
    };
    if (overrides.rawBody !== 'MISSING') {
      mockRequest.rawBody = overrides.rawBody ?? defaultBody;
    }

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => null,
      getClass: () => null,
    } as unknown as ExecutionContext;
  }

  function setupProviderInfo() {
    mockVerificationService.getProviderInfo.mockReturnValue({
      name: testProvider,
      algorithm: 'hmac-sha256',
      enabled: true,
      signatureHeader: 'X-Webhook-Signature',
      timestampHeader: 'X-Webhook-Timestamp',
    });
  }

  function setupReflector(providerName: string | null) {
    mockReflector.get.mockImplementation((key: string) => {
      if (key === WEBHOOK_PROVIDER_KEY) return providerName;
      return undefined;
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('valid request', () => {
    it('should accept a request with valid signature, timestamp, and nonce', async () => {
      setupProviderInfo();
      setupReflector(testProvider);

      const body = Buffer.from('{"type":"anomaly","metric_name":"volume"}');
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();

      mockVerificationService.verifySignature.mockReturnValue({
        valid: true,
        algorithm: 'hmac-sha256',
        provider: testProvider,
      });

      const context = createMockContext({
        rawBody: body,
        signature: `sha256=${generateValidSignature(body, timestamp, nonce)}`,
        timestamp,
        nonce,
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(mockVerificationService.verifySignature).toHaveBeenCalledWith(
        testProvider,
        body,
        expect.stringContaining('sha256='),
        timestamp,
      );
    });
  });

  describe('missing provider', () => {
    it('should reject when no provider is specified', async () => {
      setupReflector(null);

      const context = createMockContext({
        signature: 'sha256=fake',
        timestamp: String(Date.now()),
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'missing_provider' }),
      );
    });
  });

  describe('missing raw body', () => {
    it('should reject when rawBody is not available', async () => {
      setupReflector(testProvider);

      const context = createMockContext({
        rawBody: 'MISSING',
        signature: 'sha256=fake',
        timestamp: String(Date.now()),
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'missing_body' }),
      );
    });
  });

  describe('missing signature', () => {
    it('should reject when signature header is missing', async () => {
      setupReflector(testProvider);

      const context = createMockContext({
        signature: undefined,
        timestamp: String(Date.now()),
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'missing_signature' }),
      );
    });
  });

  describe('missing timestamp', () => {
    it('should reject when timestamp header is missing', async () => {
      setupReflector(testProvider);

      const context = createMockContext({
        signature: 'sha256=fake',
        timestamp: undefined,
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'missing_timestamp' }),
      );
    });
  });

  describe('invalid timestamp', () => {
    it('should reject non-numeric timestamp', async () => {
      setupReflector(testProvider);

      const context = createMockContext({
        signature: 'sha256=fake',
        timestamp: 'not-a-number',
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'invalid_timestamp' }),
      );
    });
  });

  describe('future timestamp', () => {
    it('should reject timestamp in the future', async () => {
      setupReflector(testProvider);

      const futureTimestamp = String(Date.now() + 600_000);
      const nonce = crypto.randomUUID();

      const body = Buffer.from('{"type":"anomaly"}');
      const signature = `sha256=${generateValidSignature(body, futureTimestamp, nonce)}`;

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp: futureTimestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'future_timestamp' }),
      );
    });
  });

  describe('expired timestamp', () => {
    it('should reject timestamp older than tolerance window', async () => {
      setupReflector(testProvider);

      // 10 minutes ago, tolerance is 5 minutes
      const expiredTimestamp = String(Date.now() - 600_000);
      const nonce = crypto.randomUUID();

      const body = Buffer.from('{"type":"anomaly"}');
      const signature = `sha256=${generateValidSignature(body, expiredTimestamp, nonce)}`;

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp: expiredTimestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'expired_timestamp' }),
      );
    });
  });

  describe('missing nonce', () => {
    it('should reject when nonce header is missing', async () => {
      setupReflector(testProvider);

      const timestamp = String(Date.now());
      const body = Buffer.from('{"type":"anomaly"}');
      const signature = `sha256=${generateValidSignature(body, timestamp, '')}`;

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp,
        nonce: undefined,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'missing_nonce' }),
      );
    });
  });

  describe('replayed nonce', () => {
    it('should reject duplicate nonce (replay attack)', async () => {
      setupProviderInfo();
      setupReflector(testProvider);

      const body = Buffer.from('{"type":"anomaly","metric_name":"volume"}');
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();

      mockVerificationService.verifySignature.mockReturnValue({
        valid: true,
        algorithm: 'hmac-sha256',
        provider: testProvider,
      });

      // First delivery — should succeed
      const firstContext = createMockContext({
        rawBody: body,
        signature: `sha256=${generateValidSignature(body, timestamp, nonce)}`,
        timestamp,
        nonce,
      });
      const firstResult = await guard.canActivate(firstContext);
      expect(firstResult).toBe(true);

      // Second delivery with the same nonce — should be rejected
      const secondContext = createMockContext({
        rawBody: body,
        signature: `sha256=${generateValidSignature(body, timestamp, nonce)}`,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(secondContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'replayed_nonce' }),
      );
    });
  });

  describe('tampered body', () => {
    it('should reject when signature does not match the body', async () => {
      setupProviderInfo();
      setupReflector(testProvider);

      const originalBody = Buffer.from(
        '{"type":"anomaly","metric_name":"volume"}',
      );
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();

      // Sign the original body
      const signature = `sha256=${generateValidSignature(originalBody, timestamp, nonce)}`;

      // Tamper with the body
      const tamperedBody = Buffer.from(
        '{"type":"sentiment_spike","metric_name":"volume"}',
      );

      mockVerificationService.verifySignature.mockReturnValue({
        valid: false,
        error: 'HMAC-SHA256 signature mismatch',
        provider: testProvider,
      });

      const context = createMockContext({
        rawBody: tamperedBody,
        signature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({ reason: 'signature_mismatch' }),
      );
    });
  });

  describe('wrong secret', () => {
    it('should reject when signed with a different secret', async () => {
      setupProviderInfo();
      setupReflector(testProvider);

      const body = Buffer.from('{"type":"anomaly","metric_name":"volume"}');
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();

      // Sign with the wrong secret
      const wrongSignature = `sha256=${generateValidSignature(body, timestamp, nonce, 'wrong-secret')}`;

      mockVerificationService.verifySignature.mockReturnValue({
        valid: false,
        error: 'HMAC-SHA256 signature mismatch',
        provider: testProvider,
      });

      const context = createMockContext({
        rawBody: body,
        signature: wrongSignature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('rejection metrics', () => {
    it('should call incrementCounter for every rejection', async () => {
      setupReflector(testProvider);

      const context = createMockContext({
        signature: undefined,
        timestamp: String(Date.now()),
        nonce: crypto.randomUUID(),
      });

      await guard.canActivate(context).catch(() => {});

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledTimes(1);
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'webhook_rejections_total',
        expect.objectContaining({
          reason: 'missing_signature',
          route: '/webhooks/data-processing',
          method: 'POST',
        }),
      );
    });
  });

  describe('provider fallback via header', () => {
    it('should read provider name from x-webhook-provider header when not set via decorator', async () => {
      setupProviderInfo();

      mockReflector.get.mockReturnValue(undefined);

      const body = Buffer.from('{"type":"anomaly"}');
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();

      mockVerificationService.verifySignature.mockReturnValue({
        valid: true,
        algorithm: 'hmac-sha256',
        provider: testProvider,
      });

      const context = createMockContext({
        rawBody: body,
        signature: `sha256=${generateValidSignature(body, timestamp, nonce)}`,
        timestamp,
        nonce,
        providerName: testProvider,
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });
});
