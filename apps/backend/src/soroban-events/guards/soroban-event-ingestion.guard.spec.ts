import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SorobanEventIngestionGuard } from './soroban-event-ingestion.guard';
import * as crypto from 'crypto';

describe('SorobanEventIngestionGuard', () => {
  let guard: SorobanEventIngestionGuard;
  const testSecret = 'test-soroban-secret-123';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'SOROBAN_INGEST_SECRET') return testSecret;
      if (key === 'SOROBAN_TIMESTAMP_TOLERANCE_MS') return '300000';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventIngestionGuard,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    guard = module.get<SorobanEventIngestionGuard>(SorobanEventIngestionGuard);
  });

  function createMockContext(
    overrides: {
      rawBody?: Buffer;
      signature?: string;
      timestamp?: string;
      nonce?: string;
      requestId?: string;
    } = {},
  ) {
    const rawBody =
      overrides.rawBody ??
      Buffer.from('{"txHash":"abc","eventIndex":0,"rawPayload":{}}');
    const requestId = overrides.requestId ?? 'test-request-id';

    const headers: Record<string, string> = {};
    if (overrides.signature) {
      headers['x-soroban-signature'] = overrides.signature;
    }
    if (overrides.timestamp !== undefined) {
      headers['x-soroban-timestamp'] = overrides.timestamp;
    }
    if (overrides.nonce !== undefined) {
      headers['x-soroban-nonce'] = overrides.nonce;
    }

    const mockRequest = {
      rawBody,
      headers,
      requestId,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => null,
      getClass: () => null,
    } as unknown as ExecutionContext;
  }

  function generateValidSignature(
    body: Buffer,
    timestamp: string,
    nonce: string,
    secret: string = testSecret,
  ): string {
    const payload = `${timestamp}.${nonce}.${body.toString('utf8')}`;
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  describe('canActivate', () => {
    it('should accept valid request with correct signature', async () => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(body, timestamp, nonce);

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should reject request with missing raw body', async () => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const signature = generateValidSignature(
        Buffer.from('{}'),
        timestamp,
        nonce,
      );

      const context = createMockContext({
        rawBody: undefined as unknown as Buffer,
        signature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with missing signature header', async () => {
      const context = createMockContext({ signature: undefined });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with missing timestamp header', async () => {
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );

      const context = createMockContext({
        rawBody: body,
        signature: 'some-signature',
        timestamp: undefined,
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with missing nonce header', async () => {
      const timestamp = String(Date.now());
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(body, timestamp, '');

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp,
        nonce: undefined,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with invalid timestamp format', async () => {
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );

      const context = createMockContext({
        rawBody: body,
        signature: 'some-signature',
        timestamp: 'not-a-number',
        nonce: crypto.randomUUID(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with future timestamp', async () => {
      const futureTimestamp = String(Date.now() + 600_000);
      const nonce = crypto.randomUUID();
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(body, futureTimestamp, nonce);

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp: futureTimestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with expired timestamp', async () => {
      const expiredTimestamp = String(Date.now() - 600_000);
      const nonce = crypto.randomUUID();
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(body, expiredTimestamp, nonce);

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp: expiredTimestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with tampered body', async () => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const originalBody = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(originalBody, timestamp, nonce);

      const tamperedBody = Buffer.from(
        '{"txHash":"tampered","eventIndex":0,"rawPayload":{}}',
      );

      const context = createMockContext({
        rawBody: tamperedBody,
        signature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject request with wrong secret', async () => {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );
      const signature = generateValidSignature(
        body,
        timestamp,
        nonce,
        'wrong-secret',
      );

      const context = createMockContext({
        rawBody: body,
        signature,
        timestamp,
        nonce,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject when secret is not configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SorobanEventIngestionGuard,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => null),
            },
          },
        ],
      }).compile();

      const guardNoSecret = module.get<SorobanEventIngestionGuard>(
        SorobanEventIngestionGuard,
      );

      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const body = Buffer.from(
        '{"txHash":"abc","eventIndex":0,"rawPayload":{}}',
      );

      const context = createMockContext({
        rawBody: body,
        signature: 'some-signature',
        timestamp,
        nonce,
      });

      await expect(guardNoSecret.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
