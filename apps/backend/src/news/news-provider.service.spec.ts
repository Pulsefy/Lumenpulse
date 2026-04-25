import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { NewsProviderService } from './news-provider.service';
import { CorrelationService } from '../common/correlation/correlation.service';

describe('NewsProviderService', () => {
  let service: NewsProviderService;
  let httpService: HttpService;

  const mockHttpService = {
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'CRYPTOCOMPARE_API_KEY') return 'test-key';
      return null;
    }),
  };

  const mockCorrelationService = {
    getCorrelationId: jest.fn(() => 'test-correlation-id'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsProviderService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CorrelationService, useValue: mockCorrelationService },
      ],
    }).compile();

    service = module.get<NewsProviderService>(NewsProviderService);
    httpService = module.get<HttpService>(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetchNews', () => {
    it('should fetch news from CryptoCompare', async () => {
      const mockData = {
        data: {
          Data: [
            {
              id: '1',
              title: 'Test News',
              body: 'Content',
              source: 'Source',
              url: 'http://example.com',
              published_on: 1625097600,
            },
          ],
        },
      };

      mockHttpService.get.mockReturnValue(of(mockData));

      const result = await service.fetchNews();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test News');
      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('cryptocompare.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-Id': 'test-correlation-id',
          }),
        }),
      );
    });
  });
});
