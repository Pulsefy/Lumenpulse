import { Test, TestingModule } from '@nestjs/testing';
import { AiMetricsController } from './ai-metrics.controller';
import { AiMetricsService, AiHealthReport } from './ai-metrics.service';

describe('AiMetricsController', () => {
  let controller: AiMetricsController;
  let aiMetricsService: Partial<AiMetricsService>;

  const mockReport: AiHealthReport = {
    status: 'healthy',
    timestamp: '2026-03-26T09:00:00.000Z',
    uptime: 12345,
    throttling: {
      active: false,
      reason: null,
      currentLoad: 2,
      maxConcurrent: 10,
    },
    resources: {
      totalMemoryBytes: 16e9,
      freeMemoryBytes: 8e9,
      usedMemoryBytes: 8e9,
      memoryUsageRatio: 0.5,
      heapUsedBytes: 100e6,
      heapTotalBytes: 200e6,
      rssBytes: 300e6,
      externalBytes: 10e6,
      gpuAvailable: false,
      vramTotalBytes: null,
      vramUsedBytes: null,
      vramFreeBytes: null,
      vramUsageRatio: null,
    },
    models: {
      totalLoaded: 1,
      loadTimes: { 'sentiment-v2': 1200 },
    },
    counters: {
      totalInferenceRequests: 42,
      totalInferenceErrors: 3,
      throttledRequests: 1,
    },
  };

  beforeEach(async () => {
    aiMetricsService = {
      getHealthReport: jest.fn().mockReturnValue(mockReport),
      getPrometheusMetrics: jest
        .fn()
        .mockResolvedValue('# HELP ai_inference_requests_total\n'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiMetricsController],
      providers: [
        { provide: AiMetricsService, useValue: aiMetricsService },
      ],
    }).compile();

    controller = module.get<AiMetricsController>(AiMetricsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /ai/metrics', () => {
    it('should return the health report as JSON', () => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const res = { status, json } as any;

      controller.getAiMetrics(res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockReport);
    });

    it('should return 500 on error', () => {
      (aiMetricsService.getHealthReport as jest.Mock).mockImplementation(() => {
        throw new Error('boom');
      });

      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const res = { status, json } as any;

      controller.getAiMetrics(res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /ai/metrics/prometheus', () => {
    it('should return Prometheus text format', async () => {
      const send = jest.fn();
      const set = jest.fn();
      const res = { set, send, status: jest.fn().mockReturnValue({ json: jest.fn() }) } as any;

      await controller.getPrometheusMetrics(res);

      expect(set).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(send).toHaveBeenCalledWith(
        expect.stringContaining('ai_inference_requests_total'),
      );
    });
  });

  describe('GET /ai/metrics/health', () => {
    it('should return 200 when healthy', () => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const res = { status } as any;

      controller.getAiHealth(res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'healthy' }),
      );
    });

    it('should return 503 when critical', () => {
      const criticalReport = {
        ...mockReport,
        status: 'critical' as const,
        throttling: { ...mockReport.throttling, active: true },
      };
      (aiMetricsService.getHealthReport as jest.Mock).mockReturnValue(
        criticalReport,
      );

      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const res = { status } as any;

      controller.getAiHealth(res);

      expect(status).toHaveBeenCalledWith(503);
    });
  });
});
