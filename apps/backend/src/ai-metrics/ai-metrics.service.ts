import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Histogram,
  Gauge,
  Summary,
  register,
} from 'prom-client';
import * as os from 'os';

/**
 * Snapshot of current system resource utilisation.
 */
export interface ResourceSnapshot {
  /** Total system RAM in bytes */
  totalMemoryBytes: number;
  /** Free system RAM in bytes */
  freeMemoryBytes: number;
  /** Used system RAM in bytes */
  usedMemoryBytes: number;
  /** RAM utilisation ratio (0-1) */
  memoryUsageRatio: number;
  /** Node.js heap used bytes */
  heapUsedBytes: number;
  /** Node.js heap total bytes */
  heapTotalBytes: number;
  /** Node.js RSS (resident set size) bytes */
  rssBytes: number;
  /** Node.js external memory bytes */
  externalBytes: number;
  /** Whether VRAM info is available (GPU detected) */
  gpuAvailable: boolean;
  /** Total VRAM bytes (if GPU detected) */
  vramTotalBytes: number | null;
  /** Used VRAM bytes (if GPU detected) */
  vramUsedBytes: number | null;
  /** Free VRAM bytes (if GPU detected) */
  vramFreeBytes: number | null;
  /** VRAM utilisation ratio 0-1 (if GPU detected) */
  vramUsageRatio: number | null;
}

/**
 * Full AI health report returned by GET /ai/metrics
 */
export interface AiHealthReport {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  uptime: number;
  throttling: {
    active: boolean;
    reason: string | null;
    currentLoad: number;
    maxConcurrent: number;
  };
  resources: ResourceSnapshot;
  models: {
    totalLoaded: number;
    loadTimes: Record<string, number>;
  };
  counters: {
    totalInferenceRequests: number;
    totalInferenceErrors: number;
    throttledRequests: number;
  };
}

/**
 * Service for collecting AI-layer performance metrics.
 *
 * Responsibilities:
 * - Track model load times & counts
 * - Track inference latency per model / per request
 * - Monitor system RAM and (when available) GPU VRAM
 * - Expose Prometheus-compatible gauges, counters, histograms
 * - Provide a health check that can be used to throttle requests
 */
@Injectable()
export class AiMetricsService implements OnModuleInit {
  private readonly logger = new Logger(AiMetricsService.name);

  // ── Prometheus primitives ────────────────────────────────────────

  /** Total AI inference requests */
  readonly aiRequestCounter: Counter;

  /** Total AI inference errors */
  readonly aiErrorCounter: Counter;

  /** Histogram of inference latency (seconds) per model */
  readonly aiInferenceLatency: Histogram;

  /** Histogram of model load / warm-up time (seconds) */
  readonly aiModelLoadTime: Histogram;

  /** Summary for quick percentile view of inference latency */
  readonly aiInferenceLatencySummary: Summary;

  /** Number of models currently loaded */
  readonly aiModelsLoaded: Gauge;

  /** System RAM usage ratio gauge */
  readonly systemMemoryUsageRatio: Gauge;

  /** System RAM used bytes gauge */
  readonly systemMemoryUsedBytes: Gauge;

  /** Node.js heap used bytes gauge */
  readonly nodeHeapUsedBytes: Gauge;

  /** Node.js RSS bytes gauge */
  readonly nodeRssBytes: Gauge;

  /** GPU VRAM usage ratio gauge (if available) */
  readonly gpuVramUsageRatio: Gauge;

  /** GPU VRAM used bytes gauge (if available) */
  readonly gpuVramUsedBytes: Gauge;

  /** Count of requests throttled due to resource pressure */
  readonly throttledRequestCounter: Counter;

  /** Current concurrent AI inference count */
  readonly aiConcurrentInferences: Gauge;

  // ── Internal state ───────────────────────────────────────────────

  /** Map of model name → load duration in ms */
  private readonly modelLoadTimes = new Map<string, number>();

  /** Current concurrent AI inference count */
  private concurrentInferences = 0;

  /** Maximum concurrent inferences before throttling */
  private readonly maxConcurrentInferences: number;

  /** RAM usage ratio threshold that triggers throttling */
  private readonly ramThrottleThreshold: number;

  /** VRAM usage ratio threshold that triggers throttling */
  private readonly vramThrottleThreshold: number;

  /** Interval handle for periodic resource sampling */
  private resourceSamplerInterval: ReturnType<typeof setInterval> | null = null;

  /** Resource sampling period in ms */
  private readonly samplingIntervalMs: number;

  /** Most recent GPU probe result (cached to avoid shelling out too often) */
  private cachedGpuInfo: {
    available: boolean;
    totalBytes: number | null;
    usedBytes: number | null;
    freeBytes: number | null;
    usageRatio: number | null;
  } = {
    available: false,
    totalBytes: null,
    usedBytes: null,
    freeBytes: null,
    usageRatio: null,
  };

  /** Total inference request count (fast in-memory mirror) */
  private totalInferenceRequests = 0;
  /** Total inference error count */
  private totalInferenceErrors = 0;
  /** Total throttled requests */
  private totalThrottledRequests = 0;

  // ────────────────────────────────────────────────────────────────

  constructor(private readonly config: ConfigService) {
    // Read tunables from env (with sensible defaults)
    this.maxConcurrentInferences = Number(
      this.config.get<string>('AI_MAX_CONCURRENT_INFERENCES', '10'),
    );
    this.ramThrottleThreshold = Number(
      this.config.get<string>('AI_RAM_THROTTLE_THRESHOLD', '0.90'),
    );
    this.vramThrottleThreshold = Number(
      this.config.get<string>('AI_VRAM_THROTTLE_THRESHOLD', '0.90'),
    );
    this.samplingIntervalMs = Number(
      this.config.get<string>('AI_METRICS_SAMPLING_MS', '15000'),
    );

    // ── Register Prometheus metrics ─────────────────────────────

    this.aiRequestCounter = new Counter({
      name: 'ai_inference_requests_total',
      help: 'Total number of AI inference requests',
      labelNames: ['model', 'status'],
    });

    this.aiErrorCounter = new Counter({
      name: 'ai_inference_errors_total',
      help: 'Total number of AI inference errors',
      labelNames: ['model', 'error_type'],
    });

    this.aiInferenceLatency = new Histogram({
      name: 'ai_inference_duration_seconds',
      help: 'AI inference latency in seconds',
      labelNames: ['model'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    });

    this.aiModelLoadTime = new Histogram({
      name: 'ai_model_load_duration_seconds',
      help: 'Time taken to load / warm-up an AI model (seconds)',
      labelNames: ['model'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
    });

    this.aiInferenceLatencySummary = new Summary({
      name: 'ai_inference_latency_summary',
      help: 'Summary of AI inference latency with percentiles',
      labelNames: ['model'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
      maxAgeSeconds: 600,
      ageBuckets: 5,
    });

    this.aiModelsLoaded = new Gauge({
      name: 'ai_models_loaded_count',
      help: 'Number of AI models currently loaded in memory',
    });

    this.systemMemoryUsageRatio = new Gauge({
      name: 'ai_system_memory_usage_ratio',
      help: 'System RAM usage ratio (0-1)',
    });

    this.systemMemoryUsedBytes = new Gauge({
      name: 'ai_system_memory_used_bytes',
      help: 'System RAM used (bytes)',
    });

    this.nodeHeapUsedBytes = new Gauge({
      name: 'ai_node_heap_used_bytes',
      help: 'Node.js V8 heap used (bytes)',
    });

    this.nodeRssBytes = new Gauge({
      name: 'ai_node_rss_bytes',
      help: 'Node.js RSS resident set size (bytes)',
    });

    this.gpuVramUsageRatio = new Gauge({
      name: 'ai_gpu_vram_usage_ratio',
      help: 'GPU VRAM usage ratio (0-1). -1 when not available.',
    });

    this.gpuVramUsedBytes = new Gauge({
      name: 'ai_gpu_vram_used_bytes',
      help: 'GPU VRAM used (bytes). -1 when not available.',
    });

    this.throttledRequestCounter = new Counter({
      name: 'ai_throttled_requests_total',
      help: 'Number of AI requests rejected/throttled due to resource pressure',
    });

    this.aiConcurrentInferences = new Gauge({
      name: 'ai_concurrent_inferences',
      help: 'Number of AI inferences currently running',
    });

    this.logger.log(
      `AI metrics service constructed — maxConcurrent=${this.maxConcurrentInferences}, ` +
        `ramThreshold=${this.ramThrottleThreshold}, vramThreshold=${this.vramThrottleThreshold}`,
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    // Take an initial resource reading
    this.sampleResources();

    // Start periodic sampling
    this.resourceSamplerInterval = setInterval(
      () => this.sampleResources(),
      this.samplingIntervalMs,
    );

    this.logger.log(
      `AI metrics resource sampler started (interval=${this.samplingIntervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.resourceSamplerInterval) {
      clearInterval(this.resourceSamplerInterval);
      this.resourceSamplerInterval = null;
    }
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Record a model being loaded / warmed-up.
   * @param modelName logical model identifier
   * @param durationMs time to load in milliseconds
   */
  recordModelLoad(modelName: string, durationMs: number): void {
    this.modelLoadTimes.set(modelName, durationMs);
    this.aiModelLoadTime.labels(modelName).observe(durationMs / 1000);
    this.aiModelsLoaded.set(this.modelLoadTimes.size);
    this.logger.log(
      `Model "${modelName}" loaded in ${durationMs.toFixed(1)}ms`,
    );
  }

  /**
   * Record a model being unloaded from memory.
   */
  recordModelUnload(modelName: string): void {
    this.modelLoadTimes.delete(modelName);
    this.aiModelsLoaded.set(this.modelLoadTimes.size);
    this.logger.log(`Model "${modelName}" unloaded`);
  }

  /**
   * Start an inference timing context.
   * Returns an `end` callback and increments the concurrent counter.
   */
  startInference(modelName: string): {
    end: (status: 'success' | 'error', errorType?: string) => void;
  } {
    this.concurrentInferences++;
    this.aiConcurrentInferences.set(this.concurrentInferences);
    this.totalInferenceRequests++;

    const startMs = Date.now();

    return {
      end: (status: 'success' | 'error', errorType?: string) => {
        const durationMs = Date.now() - startMs;
        const durationSec = durationMs / 1000;

        this.concurrentInferences = Math.max(0, this.concurrentInferences - 1);
        this.aiConcurrentInferences.set(this.concurrentInferences);

        this.aiRequestCounter.labels(modelName, status).inc();
        this.aiInferenceLatency.labels(modelName).observe(durationSec);
        this.aiInferenceLatencySummary.labels(modelName).observe(durationSec);

        if (status === 'error') {
          this.totalInferenceErrors++;
          this.aiErrorCounter
            .labels(modelName, errorType ?? 'unknown')
            .inc();
        }

        this.logger.debug(
          `Inference [${modelName}] completed in ${durationMs}ms — status=${status}`,
        );
      },
    };
  }

  /**
   * Evaluate whether the system should throttle new AI requests.
   * Returns `{ throttle: boolean; reason?: string }`.
   */
  shouldThrottle(): { throttle: boolean; reason: string | null } {
    // 1. Concurrency limit
    if (this.concurrentInferences >= this.maxConcurrentInferences) {
      return {
        throttle: true,
        reason: `Concurrency limit reached (${this.concurrentInferences}/${this.maxConcurrentInferences})`,
      };
    }

    // 2. System RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedRatio = (totalMem - freeMem) / totalMem;
    if (usedRatio >= this.ramThrottleThreshold) {
      return {
        throttle: true,
        reason: `System RAM usage at ${(usedRatio * 100).toFixed(1)}% (threshold ${(this.ramThrottleThreshold * 100).toFixed(0)}%)`,
      };
    }

    // 3. VRAM (if available)
    if (
      this.cachedGpuInfo.available &&
      this.cachedGpuInfo.usageRatio !== null &&
      this.cachedGpuInfo.usageRatio >= this.vramThrottleThreshold
    ) {
      return {
        throttle: true,
        reason: `GPU VRAM usage at ${(this.cachedGpuInfo.usageRatio * 100).toFixed(1)}% (threshold ${(this.vramThrottleThreshold * 100).toFixed(0)}%)`,
      };
    }

    return { throttle: false, reason: null };
  }

  /**
   * Increment the throttled-requests counter.
   */
  recordThrottledRequest(): void {
    this.totalThrottledRequests++;
    this.throttledRequestCounter.inc();
  }

  /**
   * Build a ResourceSnapshot from current system state.
   */
  getResourceSnapshot(): ResourceSnapshot {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = process.memoryUsage();

    return {
      totalMemoryBytes: totalMem,
      freeMemoryBytes: freeMem,
      usedMemoryBytes: usedMem,
      memoryUsageRatio: usedMem / totalMem,
      heapUsedBytes: memUsage.heapUsed,
      heapTotalBytes: memUsage.heapTotal,
      rssBytes: memUsage.rss,
      externalBytes: memUsage.external,
      gpuAvailable: this.cachedGpuInfo.available,
      vramTotalBytes: this.cachedGpuInfo.totalBytes,
      vramUsedBytes: this.cachedGpuInfo.usedBytes,
      vramFreeBytes: this.cachedGpuInfo.freeBytes,
      vramUsageRatio: this.cachedGpuInfo.usageRatio,
    };
  }

  /**
   * Build the full health report object.
   */
  getHealthReport(): AiHealthReport {
    const resources = this.getResourceSnapshot();
    const throttleCheck = this.shouldThrottle();

    let status: AiHealthReport['status'] = 'healthy';
    if (throttleCheck.throttle) {
      status = 'critical';
    } else if (resources.memoryUsageRatio > 0.75) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      throttling: {
        active: throttleCheck.throttle,
        reason: throttleCheck.reason,
        currentLoad: this.concurrentInferences,
        maxConcurrent: this.maxConcurrentInferences,
      },
      resources,
      models: {
        totalLoaded: this.modelLoadTimes.size,
        loadTimes: Object.fromEntries(this.modelLoadTimes),
      },
      counters: {
        totalInferenceRequests: this.totalInferenceRequests,
        totalInferenceErrors: this.totalInferenceErrors,
        throttledRequests: this.totalThrottledRequests,
      },
    };
  }

  /**
   * Return all registered AI metrics in Prometheus text format.
   */
  async getPrometheusMetrics(): Promise<string> {
    return register.metrics();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Sample system resources and update Prometheus gauges.
   * Called on a timer.
   */
  private sampleResources(): void {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const usageRatio = usedMem / totalMem;

      this.systemMemoryUsageRatio.set(usageRatio);
      this.systemMemoryUsedBytes.set(usedMem);

      const memUsage = process.memoryUsage();
      this.nodeHeapUsedBytes.set(memUsage.heapUsed);
      this.nodeRssBytes.set(memUsage.rss);

      // Attempt to probe GPU (nvidia-smi). Result is cached.
      this.probeGpu();
    } catch (err) {
      this.logger.warn(
        `Resource sampling error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Attempt to read GPU VRAM via nvidia-smi.
   * If nvidia-smi is not available the GPU is marked as unavailable
   * and we stop retrying until next sample cycle.
   */
  private probeGpu(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require('child_process');
      const output: string = execSync(
        'nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits',
        { timeout: 5000, encoding: 'utf-8' },
      ).toString();

      const parts = output.trim().split(',').map((s: string) => s.trim());
      if (parts.length >= 3) {
        const totalMiB = parseFloat(parts[0]);
        const usedMiB = parseFloat(parts[1]);
        const freeMiB = parseFloat(parts[2]);

        const totalBytes = totalMiB * 1024 * 1024;
        const usedBytes = usedMiB * 1024 * 1024;
        const freeBytes = freeMiB * 1024 * 1024;
        const usageRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;

        this.cachedGpuInfo = {
          available: true,
          totalBytes,
          usedBytes,
          freeBytes,
          usageRatio,
        };

        this.gpuVramUsageRatio.set(usageRatio);
        this.gpuVramUsedBytes.set(usedBytes);
      }
    } catch {
      // nvidia-smi not available — mark GPU as absent
      if (this.cachedGpuInfo.available) {
        this.logger.debug('GPU not detected (nvidia-smi unavailable)');
      }
      this.cachedGpuInfo = {
        available: false,
        totalBytes: null,
        usedBytes: null,
        freeBytes: null,
        usageRatio: null,
      };
      this.gpuVramUsageRatio.set(-1);
      this.gpuVramUsedBytes.set(-1);
    }
  }
}
