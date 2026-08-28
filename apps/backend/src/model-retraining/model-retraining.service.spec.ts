import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import {
  ModelRetrainingService,
  RetrainResult,
  ModelStatusResult,
} from './model-retraining.service';

describe('ModelRetrainingService', () => {
  let service: ModelRetrainingService;
  let httpService: jest.Mocked<Pick<HttpService, 'post' | 'get'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<Pick<HttpService, 'post' | 'get'>>;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PYTHON_API_URL') return 'http://localhost:8000';
        if (key === 'PYTHON_API_KEY') return 'test-key';
        return undefined;
      }),
    } as unknown as jest.Mocked<Pick<ConfigService, 'get'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRetrainingService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ModelRetrainingService>(ModelRetrainingService);
  });

  describe('triggerRetraining', () => {
    it('calls python /retrain with correct URL and headers', async () => {
      const mockResult: RetrainResult = {
        status: 'completed',
        duration_seconds: 12.5,
        models: { sentiment: 'v1.1' },
      };

      (httpService.post as jest.Mock).mockReturnValue(of({ data: mockResult }));

      const result = await service.triggerRetraining(true);

      expect(result).toEqual(mockResult);
      expect(httpService.post).toHaveBeenCalledWith(
        'http://localhost:8000/retrain',
        { force: true },
        {
          headers: { 'X-API-Key': 'test-key' },
          timeout: 300_000,
        },
      );
    });

    it('propagates error when request fails', async () => {
      const error = new AxiosError('Network Error');
      (httpService.post as jest.Mock).mockReturnValue(throwError(() => error));

      await expect(service.triggerRetraining()).rejects.toThrow(
        'Network Error',
      );
    });
  });

  describe('getModelStatus', () => {
    it('calls python /model/status with correct URL and headers', async () => {
      const mockStatus: ModelStatusResult = {
        last_run: { status: 'success' },
        registry: { active_version: 'v1.0' },
      };

      (httpService.get as jest.Mock).mockReturnValue(of({ data: mockStatus }));

      const result = await service.getModelStatus();

      expect(result).toEqual(mockStatus);
      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:8000/model/status',
        {
          headers: { 'X-API-Key': 'test-key' },
          timeout: 10_000,
        },
      );
    });
  });
});
