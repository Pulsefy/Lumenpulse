import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DataProcessingClientError,
  DataProcessingClientService,
} from '../data-processing/data-processing-client.service';
import { SentimentService } from './sentiment.service';

describe('SentimentService', () => {
  let service: SentimentService;
  const dataProcessing = {
    post: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentimentService,
        { provide: DataProcessingClientService, useValue: dataProcessing },
      ],
    }).compile();

    service = module.get<SentimentService>(SentimentService);
  });

  it('uses the shared client for sentiment analysis', async () => {
    dataProcessing.post.mockResolvedValue({ sentiment: 0.85 });

    await expect(service.analyzeSentiment('good news')).resolves.toEqual({
      sentiment: 0.85,
    });
    expect(dataProcessing.post).toHaveBeenCalledWith(
      '/analyze',
      { text: 'good news' },
      { timeoutMs: 10_000 },
    );
  });

  it('rejects empty input before calling the service', async () => {
    await expect(service.analyzeSentiment('  ')).rejects.toThrow(
      'Text cannot be empty',
    );
    expect(dataProcessing.post).not.toHaveBeenCalled();
  });

  it('preserves upstream validation errors', async () => {
    dataProcessing.post.mockRejectedValue(
      new DataProcessingClientError(
        'REQUEST_FAILED',
        'Invalid text format',
        400,
        undefined,
        { detail: 'Invalid text format' },
      ),
    );

    await expect(service.analyzeSentiment('bad input')).rejects.toThrow(
      new HttpException('Python API error: Invalid text format', 400),
    );
  });

  it('maps client availability errors to a service-unavailable response', async () => {
    dataProcessing.post.mockRejectedValue(
      new DataProcessingClientError(
        'CIRCUIT_OPEN',
        'Data-processing service circuit is open',
      ),
    );

    await expect(service.analyzeSentiment('hello')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
  });

  it.each([-1, 1])('returns the sentiment boundary score %s', async (score) => {
    dataProcessing.post.mockResolvedValue({ sentiment: score });

    await expect(service.analyzeSentiment('boundary input')).resolves.toEqual({
      sentiment: score,
    });
  });

  it('accepts long text without changing the returned score', async () => {
    dataProcessing.post.mockResolvedValue({ sentiment: 0.1 });

    await expect(service.analyzeSentiment('A'.repeat(10_000))).resolves.toEqual(
      { sentiment: 0.1 },
    );
  });

  it('maps unexpected client failures to an internal server error', async () => {
    dataProcessing.post.mockRejectedValue(new Error('unexpected failure'));

    await expect(service.analyzeSentiment('hello')).rejects.toThrow(
      'Failed to analyze sentiment: unexpected failure',
    );
  });

  it('uses the shared client for health checks', async () => {
    const health = {
      status: 'healthy',
      timestamp: '2026-09-29T00:00:00Z',
      service: 'sentiment-analysis',
    };
    dataProcessing.get.mockResolvedValue(health);

    await expect(service.checkHealth()).resolves.toEqual(health);
    expect(dataProcessing.get).toHaveBeenCalledWith('/health', {
      timeoutMs: 5_000,
    });
  });

  it('degrades failed health checks as service unavailable', async () => {
    dataProcessing.get.mockRejectedValue(
      new DataProcessingClientError('TIMEOUT', 'request timed out'),
    );

    await expect(service.checkHealth()).rejects.toThrow(
      'Python sentiment service is unhealthy',
    );
  });

  it('preserves the typed breaker error from health checks', async () => {
    dataProcessing.get.mockRejectedValue(
      new DataProcessingClientError(
        'CIRCUIT_OPEN',
        'Data-processing service circuit is open',
      ),
    );

    await expect(service.checkHealth()).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
  });
});