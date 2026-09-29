import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DataProcessingClientError,
  DataProcessingClientService,
} from '../data-processing/data-processing-client.service';
import { SentimentService } from './sentiment.service';
import { AxiosError } from 'axios';
import { Logger } from '@nestjs/common';
import { RequestContextService } from '../common/services/request-context.service';

jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

// Simple solution: Mock console methods to silence them
global.console.error = jest.fn();
global.console.warn = jest.fn();
global.console.log = jest.fn();
global.console.debug = jest.fn();

// Helper to create proper AxiosError instances for testing
const createMockAxiosError = (options: {
  response?: {
    data?: { detail?: string };
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    config?: unknown;
  };
  code?: string;
  message?: string;
  isAxiosError?: boolean;
  config?: unknown;
}): AxiosError => {
  const error = new Error(options.message) as AxiosError;

  // Set all required AxiosError properties
  Object.assign(error, {
    isAxiosError: options.isAxiosError ?? true,
    code: options.code,
    response: options.response,
    config: options.config || {},
    name: 'AxiosError',
    toJSON: () => ({
      message: error.message,
      name: error.name,
      stack: error.stack,
      config: error.config,
      code: error.code,
      status: options.response?.status,
    }),
  });

  return error;
};

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
  describe('analyzeSentiment', () => {
    const mockSuccessResponse = {
      data: { sentiment: 0.85 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    };

    beforeEach(() => {
      mockConfigService.get.mockReturnValue('http://localhost:8000');
    });

    it('should successfully analyze sentiment with valid text', async () => {
      const text = 'This is absolutely amazing!';
      mockHttpService.post.mockReturnValue(of(mockSuccessResponse));

      const result = await service.analyzeSentiment(text);

      expect(result).toEqual({ sentiment: 0.85 });
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8000/analyze',
        { text },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-ID': 'unknown',
            'X-Request-Id': 'unknown',
          },
        },
      );
    });

    it('should propagate active correlation ID in request headers', async () => {
      const text = 'Testing correlation propagation';
      mockHttpService.post.mockReturnValue(of(mockSuccessResponse));

      await RequestContextService.run(
        { correlationId: 'corr-sentiment-123' },
        async () => {
          await service.analyzeSentiment(text);
        },
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8000/analyze',
        { text },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'corr-sentiment-123',
            'X-Request-Id': 'corr-sentiment-123',
          }),
        }),
      );
    });

    it('should throw HttpException when text is empty', async () => {
      const text = '';

      await expect(service.analyzeSentiment(text)).rejects.toThrow(
        HttpException,
      );
      await expect(service.analyzeSentiment(text)).rejects.toThrow(
        'Text cannot be empty',
      );
    });

    it('should throw HttpException when text is only whitespace', async () => {
      const text = '   ';

      await expect(service.analyzeSentiment(text)).rejects.toThrow(
        HttpException,
      );
      await expect(service.analyzeSentiment(text)).rejects.toThrow(
        'Text cannot be empty',
      );
    });

    it('should handle Python API error response', async () => {
      const text = 'Test text';
      const mockError = createMockAxiosError({
        response: {
          data: { detail: 'Invalid text format' },
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: {},
        },
        message: 'Request failed with status code 400',
        isAxiosError: true,
      });

      mockHttpService.post.mockReturnValue(throwError(() => mockError));

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
    beforeEach(() => {
      mockConfigService.get.mockReturnValue('http://localhost:8000');
    });

    it('should return health status when Python API is healthy', async () => {
      mockHttpService.get.mockReturnValue(of(mockHealthResponse));

      const result = await service.checkHealth();

      expect(result).toEqual(mockHealthResponse.data);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://localhost:8000/health',
        {
          timeout: 5000,
          headers: {
            'X-Correlation-ID': 'unknown',
            'X-Request-Id': 'unknown',
          },
        },
      );
    });

    it('should throw HttpException when Python API health check fails', async () => {
      const mockError = createMockAxiosError({
        message: 'Connection failed',
        isAxiosError: true,
      });

      mockHttpService.get.mockReturnValue(throwError(() => mockError));

      await expect(service.checkHealth()).rejects.toThrow(HttpException);
      await expect(service.checkHealth()).rejects.toThrow(
        'Python sentiment service is unhealthy',
      );
    });

    it('should handle timeout during health check', async () => {
      const mockError = createMockAxiosError({
        code: 'ECONNABORTED',
        message: 'Request timeout',
        isAxiosError: true,
      });

      mockHttpService.get.mockReturnValue(throwError(() => mockError));

      await expect(service.checkHealth()).rejects.toThrow(HttpException);
      await expect(service.checkHealth()).rejects.toThrow(
        'Python sentiment service is unhealthy',
      );
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