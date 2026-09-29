import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { MetricsService } from '../metrics/metrics.service';
import {
  DataProcessingCircuitOpenError,
  DataProcessingClientError,
  DataProcessingClientService,
} from './data-processing-client.service';

describe('DataProcessingClientService', () => {
  let client: DataProcessingClientService;
  const request = jest.fn();
  const counter = {
    labels: jest.fn(() => ({ inc: jest.fn() })),
  };
  const gauge = {
    labels: jest.fn(() => ({ set: jest.fn() })),
  };
  const metrics = {
    getOrCreateCounter: jest.fn(() => counter),
    getOrCreateGauge: jest.fn(() => gauge),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'DATA_PROCESSING_URL') return 'http://processing:8000/';
      if (key === 'DATA_PROCESSING_API_KEY') return 'test-key';
      return undefined;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    client = new DataProcessingClientService(
      { request } as unknown as HttpService,
      config as unknown as ConfigService,
      metrics as unknown as MetricsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies the shared timeout and API-key header', async () => {
    request.mockReturnValue(of({ data: { ready: true } }));

    await expect(client.get('/health', { timeoutMs: 2_500 })).resolves.toEqual({
      ready: true,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://processing:8000/health',
        timeout: 2_500,
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
      }),
    );
  });

  it('returns a typed timeout error after the request times out', async () => {
    request.mockReturnValue(
      throwError(() => new AxiosError('timeout', 'ECONNABORTED')),
    );

    await expect(
      client.get('/health', { maxRetries: 0, timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 25 }),
    );
  });

  it('stops after retry exhaustion and exposes a typed request error', async () => {
    request.mockReturnValue(
      throwError(() => new AxiosError('connection refused', 'ECONNREFUSED')),
    );

    await expect(
      client.get('/health', { maxRetries: 2, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(DataProcessingClientError);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('rejects calls while open and recovers through one half-open probe', async () => {
    jest.useFakeTimers();
    request.mockReturnValue(
      throwError(() => new AxiosError('connection refused', 'ECONNREFUSED')),
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(client.get('/health', { maxRetries: 0 })).rejects.toBeInstanceOf(
        DataProcessingClientError,
      );
    }

    await expect(client.get('/health')).rejects.toBeInstanceOf(
      DataProcessingCircuitOpenError,
    );
    expect(request).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(30_000);
    request.mockReturnValue(of({ data: { ready: true } }));

    await expect(client.get('/health')).resolves.toEqual({ ready: true });
    await expect(client.get('/health')).resolves.toEqual({ ready: true });
  });
});