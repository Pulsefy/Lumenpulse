import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { register } from 'prom-client';
import { AiMetricsService } from './ai-metrics.service';

/**
 * Clear the Prometheus registry between tests to avoid
 * "duplicate metric" errors when the service is re-instantiated.
 */
function clearPrometheusRegistry() {
  register.clear();
}

describe('AiMetricsService', () => {
  let service: AiMetricsService;
  let configService: ConfigService;

  beforeEach(async () => {
    clearPrometheusRegistry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiMetricsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const env: Record<string, string> = {
                AI_MAX_CONCURRENT_INFERENCES: '3',
                AI_RAM_THROTTLE_THRESHOLD: '0.99',
                AI_VRAM_THROTTLE_THRESHOLD: '0.99',
                AI_METRICS_SAMPLING_MS: '60000',
              };
              return env[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiMetricsService>(AiMetricsService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    // Stop the periodic sampler
    service.onModuleDestroy();
    clearPrometheusRegistry();
  });

  // ── construction ──────────────────────────────────────────────

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should read configuration values from ConfigService', () => {
    expect(configService.get).toHaveBeenCalledWith(
      'AI_MAX_CONCURRENT_INFERENCES',
      '10',
    );
    expect(configService.get).toHaveBeenCalledWith(
      'AI_RAM_THROTTLE_THRESHOLD',
      '0.90',
    );
    expect(configService.get).toHaveBeenCalledWith(
      'AI_VRAM_THROTTLE_THRESHOLD',
      '0.90',
    );
    expect(configService.get).toHaveBeenCalledWith(
      'AI_METRICS_SAMPLING_MS',
      '15000',
    );
  });

  // ── model load tracking ───────────────────────────────────────

  describe('recordModelLoad / recordModelUnload', () => {
    it('should track model load times', () => {
      service.recordModelLoad('sentiment-v2', 1200);
      service.recordModelLoad('forecast-v1', 3500);

      const report = service.getHealthReport();
      expect(report.models.totalLoaded).toBe(2);
      expect(report.models.loadTimes['sentiment-v2']).toBe(1200);
      expect(report.models.loadTimes['forecast-v1']).toBe(3500);
    });

    it('should decrement loaded model count on unload', () => {
      service.recordModelLoad('sentiment-v2', 1200);
      service.recordModelLoad('forecast-v1', 3500);
      service.recordModelUnload('sentiment-v2');

      const report = service.getHealthReport();
      expect(report.models.totalLoaded).toBe(1);
      expect(report.models.loadTimes['sentiment-v2']).toBeUndefined();
      expect(report.models.loadTimes['forecast-v1']).toBe(3500);
    });
  });

  // ── inference tracking ────────────────────────────────────────

  describe('startInference', () => {
    it('should increment and decrement concurrent inferences', () => {
      const tracker = service.startInference('sentiment');

      let report = service.getHealthReport();
      expect(report.throttling.currentLoad).toBe(1);

      tracker.end('success');

      report = service.getHealthReport();
      expect(report.throttling.currentLoad).toBe(0);
    });

    it('should count total inference requests', () => {
      const t1 = service.startInference('sentiment');
      const t2 = service.startInference('forecast');
      t1.end('success');
      t2.end('success');

      const report = service.getHealthReport();
      expect(report.counters.totalInferenceRequests).toBe(2);
      expect(report.counters.totalInferenceErrors).toBe(0);
    });

    it('should count errors and error types', () => {
      const t1 = service.startInference('sentiment');
      t1.end('error', 'TimeoutError');

      const report = service.getHealthReport();
      expect(report.counters.totalInferenceErrors).toBe(1);
      expect(report.counters.totalInferenceRequests).toBe(1);
    });

    it('should handle default error type', () => {
      const t1 = service.startInference('sentiment');
      t1.end('error');

      const report = service.getHealthReport();
      expect(report.counters.totalInferenceErrors).toBe(1);
    });

    it('should never go below zero concurrent inferences', () => {
      const t1 = service.startInference('sentiment');
      t1.end('success');
      // Double-ending should not crash or go negative
      t1.end('success');

      const report = service.getHealthReport();
      expect(report.throttling.currentLoad).toBe(0);
    });
  });

  // ── throttling logic ──────────────────────────────────────────

  describe('shouldThrottle', () => {
    it('should throttle when max concurrent inferences reached', () => {
      // config has maxConcurrent = 3
      service.startInference('m1');
      service.startInference('m2');
      service.startInference('m3');

      const result = service.shouldThrottle();
      expect(result.throttle).toBe(true);
      expect(result.reason).toContain('Concurrency limit reached');
    });

    it('should not throttle when under limits', () => {
      const t = service.startInference('m1');
      const result = service.shouldThrottle();
      expect(result.throttle).toBe(false);
      expect(result.reason).toBeNull();
      t.end('success');
    });
  });

  describe('recordThrottledRequest', () => {
    it('should increment throttled request counter', () => {
      service.recordThrottledRequest();
      service.recordThrottledRequest();

      const report = service.getHealthReport();
      expect(report.counters.throttledRequests).toBe(2);
    });
  });

  // ── resource snapshot ─────────────────────────────────────────

  describe('getResourceSnapshot', () => {
    it('should return valid memory information', () => {
      const snapshot = service.getResourceSnapshot();

      expect(snapshot.totalMemoryBytes).toBeGreaterThan(0);
      expect(snapshot.freeMemoryBytes).toBeGreaterThanOrEqual(0);
      expect(snapshot.usedMemoryBytes).toBeGreaterThan(0);
      expect(snapshot.memoryUsageRatio).toBeGreaterThanOrEqual(0);
      expect(snapshot.memoryUsageRatio).toBeLessThanOrEqual(1);

      expect(snapshot.heapUsedBytes).toBeGreaterThan(0);
      expect(snapshot.heapTotalBytes).toBeGreaterThan(0);
      expect(snapshot.rssBytes).toBeGreaterThan(0);
      expect(snapshot.externalBytes).toBeGreaterThanOrEqual(0);

      // GPU is unlikely to be available in CI, so just check the field exists
      expect(typeof snapshot.gpuAvailable).toBe('boolean');
    });
  });

  // ── health report ─────────────────────────────────────────────

  describe('getHealthReport', () => {
    it('should return a well-formed report', () => {
      const report = service.getHealthReport();

      expect(report.status).toMatch(/^(healthy|degraded|critical)$/);
      expect(report.timestamp).toBeDefined();
      expect(report.uptime).toBeGreaterThanOrEqual(0);

      expect(report.throttling).toEqual(
        expect.objectContaining({
          active: expect.any(Boolean),
          currentLoad: expect.any(Number),
          maxConcurrent: 3,
        }),
      );

      expect(report.resources).toEqual(
        expect.objectContaining({
          totalMemoryBytes: expect.any(Number),
          freeMemoryBytes: expect.any(Number),
          usedMemoryBytes: expect.any(Number),
          memoryUsageRatio: expect.any(Number),
        }),
      );

      expect(report.models).toEqual({
        totalLoaded: 0,
        loadTimes: {},
      });

      expect(report.counters).toEqual({
        totalInferenceRequests: 0,
        totalInferenceErrors: 0,
        throttledRequests: 0,
      });
    });

    it('should report critical status when throttling is active', () => {
      // Fill concurrency to trigger throttle
      service.startInference('m1');
      service.startInference('m2');
      service.startInference('m3');

      const report = service.getHealthReport();
      expect(report.status).toBe('critical');
      expect(report.throttling.active).toBe(true);
    });
  });

  // ── Prometheus output ─────────────────────────────────────────

  describe('getPrometheusMetrics', () => {
    it('should return a non-empty Prometheus text payload', async () => {
      const output = await service.getPrometheusMetrics();
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);

      // Should contain our custom metrics
      expect(output).toContain('ai_inference_requests_total');
      expect(output).toContain('ai_inference_duration_seconds');
      expect(output).toContain('ai_model_load_duration_seconds');
      expect(output).toContain('ai_system_memory_usage_ratio');
      expect(output).toContain('ai_concurrent_inferences');
      expect(output).toContain('ai_throttled_requests_total');
    });

    it('should include recorded model load metrics', async () => {
      service.recordModelLoad('test-model', 500);

      const output = await service.getPrometheusMetrics();
      expect(output).toContain('ai_models_loaded_count');
    });

    it('should include inference latency after a request', async () => {
      const tracker = service.startInference('test-model');
      tracker.end('success');

      const output = await service.getPrometheusMetrics();
      expect(output).toContain('ai_inference_duration_seconds');
      expect(output).toContain('test-model');
    });
  });

  // ── lifecycle ─────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should not throw', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop the sampler without errors', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
      // calling it twice should still be safe
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
