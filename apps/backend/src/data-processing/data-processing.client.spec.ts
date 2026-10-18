import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { NEVER, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { Registry } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import { RequestContextService } from '../common/services/request-context.service';
import {
  DataProcessingClient,
  DataProcessingUnavailableError,
} from './data-processing.client';

describe('DataProcessingClient', () => {
  let http: { request: jest.Mock };
  let registry: Registry;
  let client: DataProcessingClient;
  const networkError = new AxiosError('connection failed', 'ECONNREFUSED');
  const response = { data: { sentiment: 0.5 } };

  function create(overrides: Record<string, string | number> = {}) {
    registry = new Registry();
    const settings: Record<string, string | number> = {
      PYTHON_API_URL: 'http://python:8000/',
      PYTHON_API_KEY: 'secret',
      PYTHON_CLIENT_TIMEOUT_MS: 20,
      PYTHON_CLIENT_MAX_RETRIES: 2,
      PYTHON_CLIENT_FAILURE_THRESHOLD: 1,
      PYTHON_CLIENT_RESET_MS: 1000,
      ...overrides,
    };
    client = new DataProcessingClient(
      http as unknown as HttpService,
      { get: (key: string) => settings[key] } as ConfigService,
      { registry } as MetricsService,
    );
  }
  beforeEach(() => {
    jest.useFakeTimers();
    http = { request: jest.fn().mockReturnValue(of(response)) };
    create();
  });
  afterEach(() => jest.useRealTimers());

  it('owns base URL, API key, timeout, redirect safety, and context headers', async () => {
    await RequestContextService.run({ correlationId: 'corr-123' }, () =>
      firstValueFrom(client.post('/analyze', { text: 'hello' })),
    );
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://python:8000/analyze',
        method: 'POST',
        timeout: 20,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret',
          'X-Correlation-ID': 'corr-123',
          'X-Request-Id': 'corr-123',
        },
      }),
    );
  });

  it('bounds a hung transport, cancels it, and returns a typed timeout', async () => {
    create({ PYTHON_CLIENT_MAX_RETRIES: 0 });
    http.request.mockReturnValue(NEVER);
    const pending = expect(
      firstValueFrom(client.get('/health')),
    ).rejects.toMatchObject({ reason: 'timeout' });
    await jest.advanceTimersByTimeAsync(20);
    await pending;
    expect(http.request.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('retries transient failures with a bounded budget and exports outcomes', async () => {
    http.request.mockReturnValue(throwError(() => networkError));
    const pending = expect(
      firstValueFrom(client.get('/health')),
    ).rejects.toBeInstanceOf(DataProcessingUnavailableError);
    await jest.advanceTimersByTimeAsync(300);
    await pending;
    expect(http.request).toHaveBeenCalledTimes(3);
    expect(await registry.metrics()).toContain(
      'data_processing_requests_total{method="GET",outcome="retry"} 2',
    );
    expect(await registry.metrics()).toContain(
      'data_processing_breaker_state 1',
    );
  });

  it('recovers on a successful retry', async () => {
    http.request.mockReturnValueOnce(throwError(() => networkError));
    const pending = firstValueFrom(client.post('/analyze', { text: 'hello' }));
    await jest.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual(response);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it.each(['/retrain', '/api/rebuild/all'])(
    'does not replay mutating POST %s after an ambiguous failure',
    async (path) => {
      http.request.mockReturnValue(throwError(() => networkError));
      await expect(
        firstValueFrom(client.post(path, {})),
      ).rejects.toBeInstanceOf(DataProcessingUnavailableError);
      expect(http.request).toHaveBeenCalledTimes(1);
    },
  );

  it('fails fast while open, allows one recovery probe, then closes', async () => {
    create({ PYTHON_CLIENT_MAX_RETRIES: 0 });
    http.request.mockReturnValueOnce(throwError(() => networkError));
    await expect(firstValueFrom(client.get('/health'))).rejects.toThrow();
    await expect(firstValueFrom(client.get('/health'))).rejects.toMatchObject({
      reason: 'circuit_open',
    });
    expect(http.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    const probe = new Subject<typeof response>();
    http.request.mockReturnValueOnce(probe);
    const pending = firstValueFrom(client.get('/health'));
    await expect(firstValueFrom(client.get('/health'))).rejects.toMatchObject({
      reason: 'circuit_open',
    });
    expect(await registry.metrics()).toContain(
      'data_processing_breaker_state 2',
    );
    probe.next(response);
    await pending;
    await expect(firstValueFrom(client.get('/health'))).resolves.toEqual(
      response,
    );
    expect(await registry.metrics()).toContain(
      'data_processing_breaker_state 0',
    );
  });

  it('reopens after a failed recovery probe without retrying it', async () => {
    create({ PYTHON_CLIENT_MAX_RETRIES: 0 });
    http.request.mockReturnValue(throwError(() => networkError));
    await expect(firstValueFrom(client.get('/health'))).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(firstValueFrom(client.get('/health'))).rejects.toThrow();
    await expect(firstValueFrom(client.get('/health'))).rejects.toMatchObject({
      reason: 'circuit_open',
    });
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('does not let an older in-flight success close an opened breaker', async () => {
    create({ PYTHON_CLIENT_MAX_RETRIES: 0 });
    const old = new Subject<typeof response>();
    http.request
      .mockReturnValueOnce(old)
      .mockReturnValueOnce(throwError(() => networkError));
    const pending = firstValueFrom(client.get('/health'));
    await expect(firstValueFrom(client.get('/health'))).rejects.toThrow();
    old.next(response);
    await pending;
    await expect(firstValueFrom(client.get('/health'))).rejects.toMatchObject({
      reason: 'circuit_open',
    });
  });

  it('passes validation failures through without retries or opening the breaker', async () => {
    const error = {
      isAxiosError: true,
      response: { status: 422 },
      message: 'invalid',
    };
    http.request.mockReturnValueOnce(throwError(() => error));
    await expect(firstValueFrom(client.post('/analyze', {}))).rejects.toBe(
      error,
    );
    await expect(firstValueFrom(client.get('/health'))).resolves.toEqual(
      response,
    );
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('honors no-retry health probes and a bounded per-request timeout', async () => {
    http.request.mockReturnValue(NEVER);
    const pending = expect(
      firstValueFrom(client.get('/health', { timeout: 3, retry: false })),
    ).rejects.toMatchObject({ reason: 'timeout' });
    await jest.advanceTimersByTimeAsync(3);
    await pending;
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it.each(['https://example.com', '//example.com', '/\\example.com'])(
    'rejects credential forwarding to %s',
    async (path) => {
      await expect(firstValueFrom(client.get(path))).rejects.toThrow(
        'relative',
      );
      expect(http.request).not.toHaveBeenCalled();
    },
  );
});
