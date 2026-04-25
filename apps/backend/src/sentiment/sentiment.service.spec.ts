import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { SentimentService } from './sentiment.service';
import { CorrelationService } from '../common/correlation/correlation.service';

describe('SentimentService', () => {
  let service: SentimentService;
  let httpService: HttpService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockCorrelationService = {
    getCorrelationId: jest.fn(() => 'test-correlation-id'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentimentService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: CorrelationService, useValue: mockCorrelationService },
      ],
    }).compile();

    service = module.get<SentimentService>(SentimentService);
    httpService = module.get<HttpService>(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeSentiment', () => {
    it('should successfully analyze sentiment with valid text', async () => {
      const text = 'This is absolutely amazing!';
      const mockResponse = {
        data: { sentiment: 0.85 },
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.analyzeSentiment(text);

      expect(result).toEqual({ sentiment: 0.85 });
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8000/analyze',
        { text },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': 'test-correlation-id',
          },
        },
      );
    });
  });
});
