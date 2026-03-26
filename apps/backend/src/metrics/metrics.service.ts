import { Injectable, Logger } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
  register,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Service for collecting and exposing application metrics
 * Compatible with Prometheus monitoring and scraping
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // HTTP Request Metrics
  private readonly httpRequestCounter: Counter;
  private readonly httpRequestDuration: Histogram;
  private readonly httpErrorCounter: Counter;

  // Job Queue Metrics
  private readonly jobQueueSize: Gauge;
  private readonly jobsProcessed: Counter;
  private readonly jobsFailedCounter: Counter;

  // Custom Metrics
  private readonly customGauges = new Map<string, Gauge>();
  private readonly customCounters = new Map<string, Counter>();

  constructor() {
    // Initialize default Node.js metrics (memory, CPU, etc.)
    collectDefaultMetrics({ register });

    // HTTP Request Counter - tracks total requests by method and path
    this.httpRequestCounter = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
    });

    // HTTP Request Latency Histogram - tracks request duration
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5], // 10ms to 5s
    });

    // HTTP Error Counter - tracks errors specifically
    this.httpErrorCounter = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['method', 'route', 'status'],
    });

    // Job Queue Size Gauge - tracks current queue size
    this.jobQueueSize = new Gauge({
      name: 'job_queue_size',
      help: 'Current size of the job queue',
      labelNames: ['queue_name'],
    });

    // Jobs Processed Counter - tracks completed jobs
    this.jobsProcessed = new Counter({
      name: 'jobs_processed_total',
      help: 'Total number of jobs processed',
      labelNames: ['queue_name', 'status'],
    });

    // Jobs Failed Counter - tracks failed jobs
    this.jobsFailedCounter = new Counter({
      name: 'jobs_failed_total',
      help: 'Total number of failed jobs',
      labelNames: ['queue_name'],
    });

    this.logger.log('Metrics service initialized');
  }

  /**
   * Record an HTTP request
   * @param method HTTP method
   * @param route Request route/path
   * @param statusCode HTTP status code
   * @param durationMs Duration in milliseconds
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const labels = { method, route, status: String(statusCode) };

    // Increment total requests counter
    this.httpRequestCounter.inc(labels);

    // Record request duration
    this.httpRequestDuration.labels(labels).observe(durationMs / 1000); // Convert to seconds

    // Track errors separately
    if (statusCode >= 400) {
      this.httpErrorCounter.inc(labels);
    }
  }

  /**
   * Update job queue size
   * @param queueName Name of the queue
   * @param size Current queue size
   */
  setJobQueueSize(queueName: string, size: number): void {
    this.jobQueueSize.labels(queueName).set(size);
  }

  /**
   * Increment job counter
   * @param queueName Name of the queue
   * @param status Status of the job (success, failure)
   */
  recordJobProcessed(queueName: string, status: 'success' | 'failure'): void {
    this.jobsProcessed.labels(queueName, status).inc();

    if (status === 'failure') {
      this.jobsFailedCounter.labels(queueName).inc();
    }
  }

  /**
   * Get or create a custom gauge
   * Useful for tracking custom application metrics
   * @param name Metric name
   * @param help Metric description
   * @param labelNames Optional label names
   */
  getOrCreateGauge(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Gauge {
    if (!this.customGauges.has(name)) {
      const gauge = new Gauge({
        name,
        help,
        labelNames,
      });
      this.customGauges.set(name, gauge);
    }
    return this.customGauges.get(name)!;
  }

  /**
   * Get or create a custom counter
   * Useful for tracking custom application metrics
   * @param name Metric name
   * @param help Metric description
   * @param labelNames Optional label names
   */
  getOrCreateCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Counter {
    if (!this.customCounters.has(name)) {
      const counter = new Counter({
        name,
        help,
        labelNames,
      });
      this.customCounters.set(name, counter);
    }
    return this.customCounters.get(name)!;
  }

  /**
   * Export all metrics in Prometheus format
   * @returns Prometheus-formatted metrics as string
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Get metrics as JSON representation
   * Useful for JSON-based monitoring endpoints
   * @returns Object with metric values
   */
  getMetricsAsJson(): Record<string, unknown> {
    const metricsArray = register.getMetricsAsArray();
    const result: Record<string, unknown> = {};

    for (const item of metricsArray) {
      result[item.name] = item;
    }

    return result;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics(): void {
    register.resetMetrics();
    this.logger.warn('All metrics have been reset');
  }
}
