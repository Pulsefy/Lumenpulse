import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * MetricsService
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  // Dedicated Registry — avoids collisions with the global prom-client default
  // register when running multiple test suites in the same process.
  readonly registry = new Registry();

  // HTTP / infrastructure //
  private readonly httpRequestCounter: Counter<string>;
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpErrorCounter: Counter<string>;
  private readonly jobQueueSize: Gauge<string>;
  private readonly jobsProcessed: Counter<string>;
  private readonly jobsFailedCounter: Counter<string>;

  // Data-pipeline //
  private readonly articlesProcessedCounter: Counter<string>;
  private readonly sentimentGauge: Gauge<string>;
  private readonly modelInferenceHistogram: Histogram<string>;
  private readonly anomaliesDetectedCounter: Counter<string>;
  private readonly fetchErrorsCounter: Counter<string>;

  // Running totals for the rolling-average sentiment gauge
  private sentimentSum = 0;
  private sentimentCount = 0;

  // Escape-hatch maps for callers of the legacy getOrCreate* API
  private readonly customGauges = new Map<string, Gauge<string>>();
  private readonly customCounters = new Map<string, Counter<string>>();

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    // HTTP//
    this.httpRequestCounter = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpErrorCounter = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    // Job queue //
    this.jobQueueSize = new Gauge({
      name: 'job_queue_size',
      help: 'Current size of the job queue',
      labelNames: ['queue_name'] as const,
      registers: [this.registry],
    });

    this.jobsProcessed = new Counter({
      name: 'jobs_processed_total',
      help: 'Total number of jobs processed',
      labelNames: ['queue_name', 'status'] as const,
      registers: [this.registry],
    });

    this.jobsFailedCounter = new Counter({
      name: 'jobs_failed_total',
      help: 'Total number of failed jobs',
      labelNames: ['queue_name'] as const,
      registers: [this.registry],
    });

    // Data-pipeline //
    this.articlesProcessedCounter = new Counter({
      name: 'lumenpulse_articles_processed_total',
      help: 'Total crypto-news articles processed by the pipeline',
      labelNames: ['source', 'status'] as const,
      registers: [this.registry],
    });

    this.sentimentGauge = new Gauge({
      name: 'lumenpulse_sentiment_score',
      help: 'Rolling average sentiment score (-1 bearish → +1 bullish)',
      labelNames: ['source'] as const,
      registers: [this.registry],
    });

    this.modelInferenceHistogram = new Histogram({
      name: 'lumenpulse_model_inference_duration_seconds',
      help: 'Wall-clock latency of ML model inference calls',
      labelNames: ['model', 'task'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.anomaliesDetectedCounter = new Counter({
      name: 'lumenpulse_anomalies_detected_total',
      help: 'Price / sentiment anomalies flagged by the detection model',
      labelNames: ['type', 'severity'] as const,
      registers: [this.registry],
    });

    this.fetchErrorsCounter = new Counter({
      name: 'lumenpulse_fetch_errors_total',
      help: 'Errors encountered while fetching news from external sources',
      labelNames: ['source', 'error_code'] as const,
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    this.logger.log(
      'MetricsService ready — unified Prometheus registry active',
    );
  }

  // Scrape helpers (MetricsController) //

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getMetricsAsJson(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const item of this.registry.getMetricsAsArray()) {
      result[item.name] = item;
    }
    return result;
  }

  resetMetrics(): void {
    this.registry.resetMetrics();
    this.sentimentSum = 0;
    this.sentimentCount = 0;
    this.logger.warn('All metrics reset');
  }

  // HTTP instrumentation (MetricsInterceptor)//
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const labels = { method, route, status: String(statusCode) };
    this.httpRequestCounter.inc(labels);
    this.httpRequestDuration.labels(labels).observe(durationMs / 1000);
    if (statusCode >= 400) {
      this.httpErrorCounter.inc(labels);
    }
  }

  // Job-queue instrumentation

  setJobQueueSize(queueName: string, size: number): void {
    this.jobQueueSize.labels(queueName).set(size);
  }

  recordJobProcessed(queueName: string, status: 'success' | 'failure'): void {
    this.jobsProcessed.labels(queueName, status).inc();
    if (status === 'failure') {
      this.jobsFailedCounter.labels(queueName).inc();
    }
  }

  /**
   * Call once per article that exits the processing pipeline.
   *
   * @param source  Feed identifier, e.g. "coindesk"
   * @param status  "success" | "skipped" | "duplicate"
   */
  recordArticleProcessed(
    source: string,
    status: 'success' | 'skipped' | 'duplicate' = 'success',
  ): void {
    this.articlesProcessedCounter.inc({ source, status });
  }

  /**
   * Update the global rolling-average sentiment gauge.
   * Call once per article after inference returns.
   *
   * @param score   Raw model score in [-1, 1]
   * @param source  Feed identifier (defaults to "all")
   */
  recordSentimentScore(score: number, source = 'all'): void {
    this.sentimentSum += score;
    this.sentimentCount += 1;
    this.sentimentGauge.set(
      { source },
      this.sentimentSum / this.sentimentCount,
    );
  }

  /**
   * Observe a completed inference call.
   *
   * @param durationSeconds  Elapsed wall-clock time
   * @param model            Model name/version, e.g. "finbert-v2"
   * @param task             "sentiment" | "anomaly"
   */
  recordModelInference(
    durationSeconds: number,
    model = 'default',
    task: 'sentiment' | 'anomaly' = 'sentiment',
  ): void {
    this.modelInferenceHistogram.observe({ model, task }, durationSeconds);
  }

  /**
   * Start a latency timer; call the returned function when inference ends.
   *
   * @example
   *   const end = metricsService.startInferenceTimer('finbert-v2', 'sentiment');
   *   const score = await model.infer(text);
   *   end();
   */
  startInferenceTimer(
    model = 'default',
    task: 'sentiment' | 'anomaly' = 'sentiment',
  ): () => void {
    return this.modelInferenceHistogram.startTimer({ model, task });
  }

  /**
   * Increment the anomaly counter.
   *
   * @param type      "price_spike" | "volume_surge" | "sentiment_shift" | …
   * @param severity  "low" | "medium" | "high" | "critical"
   */
  recordAnomalyDetected(
    type: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  ): void {
    this.anomaliesDetectedCounter.inc({ type, severity });
  }

  /**
   * Increment the fetch-error counter.
   *
   * @param source     Feed identifier
   * @param errorCode  HTTP status string or key, e.g. "429", "TIMEOUT"
   */
  recordFetchError(source: string, errorCode = 'UNKNOWN'): void {
    this.fetchErrorsCounter.inc({ source, error_code: errorCode });
  }

  //Dynamic metric helpers (legacy API)

  getOrCreateGauge(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Gauge<string> {
    if (!this.customGauges.has(name)) {
      this.customGauges.set(
        name,
        new Gauge({ name, help, labelNames, registers: [this.registry] }),
      );
    }
    return this.customGauges.get(name)!;
  }

  getOrCreateCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Counter<string> {
    if (!this.customCounters.has(name)) {
      this.customCounters.set(
        name,
        new Counter({ name, help, labelNames, registers: [this.registry] }),
      );
    }
    return this.customCounters.get(name)!;
  }
}
