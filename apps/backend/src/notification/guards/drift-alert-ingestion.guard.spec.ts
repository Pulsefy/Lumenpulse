import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DriftAlertIngestionGuard } from './drift-alert-ingestion.guard';

describe('DriftAlertIngestionGuard', () => {
  let guard: DriftAlertIngestionGuard;
  const testSecret = 'test-drift-alert-secret';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'DRIFT_ALERT_INGEST_SECRET') return testSecret;
      if (key === 'DRIFT_ALERT_TIMESTAMP_TOLERANCE_MS') return '300000';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftAlertIngestionGuard,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    guard = module.get<DriftAlertIngestionGuard>(DriftAlertIngestionGuard);
  });

  function createMockContext(
    overrides: {
      rawBody?: Buffer;
      signature?: string;
      timestamp?: string;
    } = {},
  ) {
    const rawBody =
      overrides.rawBody ?? Buffer.from('{"type":"drift","title":"t"}');
    const headers: Record<string, string> = {};
    if (overrides.signature) {
      headers['x-drift-alert-signature'] = overrides.signature;
    }
    if (overrides.timestamp !== undefined) {
      headers['x-drift-alert-timestamp'] = overrides.timestamp;
    }

    const mockRequest = { rawBody, headers, requestId: 'test-request-id' };

    return {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
      getHandler: () => null,
      getClass: () => null,
    } as unknown as ExecutionContext;
  }

  function generateValidSignature(
    body: Buffer,
    timestamp: string,
    secret: string = testSecret,
  ): string {
    const payload = `${timestamp}.${body.toString('utf8')}`;
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  it('accepts a request signed with the shared secret', async () => {
    const timestamp = String(Date.now());
    const body = Buffer.from('{"type":"drift","title":"t"}');
    const signature = generateValidSignature(body, timestamp);

    const context = createMockContext({ rawBody: body, signature, timestamp });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a missing signature header', async () => {
    const context = createMockContext({ signature: undefined });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing timestamp header', async () => {
    const body = Buffer.from('{"type":"drift"}');
    const context = createMockContext({
      rawBody: body,
      signature: generateValidSignature(body, String(Date.now())),
      timestamp: undefined,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired timestamp', async () => {
    const expired = String(Date.now() - 600_000);
    const body = Buffer.from('{"type":"drift"}');
    const context = createMockContext({
      rawBody: body,
      signature: generateValidSignature(body, expired),
      timestamp: expired,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a future timestamp', async () => {
    const future = String(Date.now() + 600_000);
    const body = Buffer.from('{"type":"drift"}');
    const context = createMockContext({
      rawBody: body,
      signature: generateValidSignature(body, future),
      timestamp: future,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a tampered body', async () => {
    const timestamp = String(Date.now());
    const original = Buffer.from('{"type":"drift","title":"t"}');
    const tampered = Buffer.from('{"type":"drift","title":"spoofed"}');
    const context = createMockContext({
      rawBody: tampered,
      signature: generateValidSignature(original, timestamp),
      timestamp,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a signature from the wrong secret', async () => {
    const timestamp = String(Date.now());
    const body = Buffer.from('{"type":"drift"}');
    const context = createMockContext({
      rawBody: body,
      signature: generateValidSignature(body, timestamp, 'wrong-secret'),
      timestamp,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when the secret is not configured', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftAlertIngestionGuard,
        { provide: ConfigService, useValue: { get: jest.fn(() => null) } },
      ],
    }).compile();

    const guardNoSecret = module.get<DriftAlertIngestionGuard>(
      DriftAlertIngestionGuard,
    );

    const timestamp = String(Date.now());
    const body = Buffer.from('{"type":"drift"}');
    const context = createMockContext({
      rawBody: body,
      signature: generateValidSignature(body, timestamp, 'anything'),
      timestamp,
    });

    await expect(guardNoSecret.canActivate(context)).rejects.toThrow();
  });
});
