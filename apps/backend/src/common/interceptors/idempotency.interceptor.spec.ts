import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { throwError, firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import {
  IdempotencyRecord,
  IdempotencyRecordStatus,
} from '../../idempotency/idempotency-record.entity';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;

  const mockService = {
    acquire: jest.fn(),
    complete: jest.fn(),
    release: jest.fn(),
    waitForCompletion: jest.fn(),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
    get: jest.fn(),
  };

  const makeRecord = (overrides: Partial<IdempotencyRecord> = {}) =>
    ({
      id: 'record-id',
      key: 'test-key',
      method: 'POST',
      route: '/test',
      requestHash: 'hash',
      status: IdempotencyRecordStatus.COMPLETED,
      responseStatus: HttpStatus.CREATED,
      responseBody: { success: true },
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 86_400_000),
      completedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    }) as IdempotencyRecord;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: IdempotencyService, useValue: mockService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
  });

  function createMockContext(
    method: string,
    headers: Record<string, string>,
    body: unknown,
  ): ExecutionContext {
    const status = jest.fn().mockReturnThis();
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, headers, body, path: '/test' }),
        getResponse: () => ({ status }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  const next: CallHandler = { handle: () => of({ ok: true }) };

  it('passes through when no Idempotency-Key header is present', async () => {
    const context = createMockContext('POST', {}, { amount: 100 });

    const obs = await interceptor.intercept(context, next);

    await expect(firstValueFrom(obs)).resolves.toEqual({ ok: true });
    expect(mockService.acquire).not.toHaveBeenCalled();
  });

  it('passes through when the method is not a write method', async () => {
    const context = createMockContext(
      'GET',
      { 'idempotency-key': 'test-key' },
      {},
    );

    const obs = await interceptor.intercept(context, next);

    await expect(firstValueFrom(obs)).resolves.toEqual({ ok: true });
    expect(mockService.acquire).not.toHaveBeenCalled();
  });

  it('replays the cached response for a repeated key', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    mockService.acquire.mockResolvedValue({
      kind: 'replay',
      record: makeRecord(),
    });

    const obs = await interceptor.intercept(context, next);

    await expect(firstValueFrom(obs)).resolves.toEqual({ success: true });
    expect(mockService.complete).not.toHaveBeenCalled();
  });

  it('throws UnprocessableEntity when the key is reused with a different body', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    mockService.acquire.mockResolvedValue({
      kind: 'hash-mismatch',
      record: makeRecord(),
    });

    await expect(interceptor.intercept(context, next)).rejects.toThrow(
      'Idempotency key was used with a different request body.',
    );
  });

  it('waits for an in-progress request and returns its response', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    const completed = makeRecord();
    mockService.acquire.mockResolvedValue({
      kind: 'in-progress',
      record: makeRecord({ status: IdempotencyRecordStatus.IN_PROGRESS }),
    });
    mockService.waitForCompletion.mockResolvedValue(completed);

    const obs = await interceptor.intercept(context, next);

    await expect(firstValueFrom(obs)).resolves.toEqual({ success: true });
    expect(mockService.waitForCompletion).toHaveBeenCalledWith('record-id');
  });

  it('throws Conflict when the in-progress request does not complete in time', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    mockService.acquire.mockResolvedValue({
      kind: 'in-progress',
      record: makeRecord({ status: IdempotencyRecordStatus.IN_PROGRESS }),
    });
    mockService.waitForCompletion.mockResolvedValue(null);

    await expect(interceptor.intercept(context, next)).rejects.toThrow(
      'Request with this idempotency key is already in progress.',
    );
  });

  it('executes the handler and persists the response for a fresh key', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    const record = makeRecord({ status: IdempotencyRecordStatus.IN_PROGRESS });
    mockService.acquire.mockResolvedValue({ kind: 'acquired', record });
    mockService.complete.mockResolvedValue(undefined);

    const obs = await interceptor.intercept(context, next);

    await expect(firstValueFrom(obs)).resolves.toEqual({ ok: true });
    expect(mockService.complete).toHaveBeenCalledWith(
      record,
      HttpStatus.CREATED,
      { ok: true },
    );
  });

  it('releases the claim and rethrows when the handler fails', async () => {
    const context = createMockContext(
      'POST',
      { 'idempotency-key': 'test-key' },
      { amount: 100 },
    );
    const record = makeRecord({ status: IdempotencyRecordStatus.IN_PROGRESS });
    mockService.acquire.mockResolvedValue({ kind: 'acquired', record });
    mockService.release.mockResolvedValue(undefined);
    const failingNext: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      firstValueFrom(await interceptor.intercept(context, failingNext)),
    ).rejects.toThrow('boom');
    expect(mockService.release).toHaveBeenCalledWith('record-id');
  });
});
