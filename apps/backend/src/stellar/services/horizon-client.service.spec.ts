import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { HorizonClientService } from './horizon-client.service';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('HorizonClientService', () => {
  let service: HorizonClientService;

  const mockMetricsService = {
    recordHorizonRequest: jest.fn(),
    recordHorizonError: jest.fn(),
  };

  const mockRequestContextService = {
    getRequestId: jest.fn().mockReturnValue('test-request-id'),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('testnet'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorizonClientService,
        { provide: MetricsService, useValue: mockMetricsService },
        {
          provide: RequestContextService,
          useValue: mockRequestContextService,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<HorizonClientService>(HorizonClientService);

    mockFetch.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTransactions', () => {
    it('should fetch transactions and record metrics on success', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              { id: 'tx1', created_at: '2024-01-01', successful: true },
            ],
          },
          _links: {},
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const result = await service.getTransactions('GABC123', 10);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe('tx1');
      expect(mockMetricsService.recordHorizonRequest).toHaveBeenCalledWith(
        'getTransactions',
        'success',
        expect.any(Number),
      );
    });

    it('should record metrics on error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          detail: 'Internal server error',
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      await expect(service.getTransactions('GABC123', 10)).rejects.toThrow(
        'Internal server error',
      );

      expect(mockMetricsService.recordHorizonError).toHaveBeenCalledWith(
        'getTransactions',
        '500',
      );
    });

    it('should include correlation ID in request headers', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: { records: [] },
          _links: {},
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      await service.getTransactions('GABC123', 10);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-Id': 'test-request-id',
          }),
        }),
      );
    });

    it('should extract nextPage cursor from response', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: { records: [] },
          _links: {
            next: {
              href: 'https://horizon-testnet.stellar.org/transactions?cursor=12345',
            },
          },
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const result = await service.getTransactions('GABC123', 10);

      expect(result.nextPage).toBe('12345');
    });
  });

  describe('getOperations', () => {
    it('should fetch operations and record metrics on success', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              {
                id: 'op1',
                type: 'payment',
                created_at: '2024-01-01',
              },
            ],
          },
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const result = await service.getOperations('tx123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('op1');
      expect(mockMetricsService.recordHorizonRequest).toHaveBeenCalledWith(
        'getOperations',
        'success',
        expect.any(Number),
      );
    });

    it('should return empty array on error', async () => {
      mockFetch.mockReset();

      const mockResponse = {
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({}),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const result = await service.getOperations('nonexistent');

      expect(result).toEqual([]);
      expect(mockMetricsService.recordHorizonError).toHaveBeenCalledWith(
        'getOperations',
        '404',
      );
    });
  });

  describe('network errors', () => {
    it('should handle network failures gracefully', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));

      await expect(service.getTransactions('GABC123', 10)).rejects.toThrow(
        'ECONNRESET',
      );

      expect(mockMetricsService.recordHorizonError).toHaveBeenCalledWith(
        'getTransactions',
        'NETWORK_ERROR',
      );
    });
  });
});
