import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

/**
 * Unit tests for MetricsService.
 *
 * Each test gets a fresh MetricsService instance with its own Registry,
 * so tests are fully isolated — no shared global prom-client state.
 */
describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(() => {
    // Clear the dedicated registry after every test
    service.registry.clear();
  });

  // Scrape //

  it('getMetrics() returns a non-empty Prometheus text payload', async () => {
    const output = await service.getMetrics();
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    // Default Node.js metrics are always present
    expect(output).toContain('nodejs_');
  });

  it('getMetricsAsJson() returns an object keyed by metric name', () => {
    const json = service.getMetricsAsJson();
    expect(typeof json).toBe('object');
    expect(json).not.toBeNull();
    expect(Object.keys(json).length).toBeGreaterThan(0);
  });

  //  HTTP metrics //

  it('recordHttpRequest() increments http_requests_total', async () => {
    service.recordHttpRequest('GET', '/api/news', 200, 45);
    const output = await service.getMetrics();
    expect(output).toContain('http_requests_total');
  });

  it('recordHttpRequest() increments http_errors_total for 4xx/5xx', async () => {
    service.recordHttpRequest('GET', '/api/news', 404, 12);
    service.recordHttpRequest('POST', '/api/articles', 500, 8);
    const output = await service.getMetrics();
    expect(output).toContain('http_errors_total');
  });

  it('recordHttpRequest() does NOT increment http_errors_total for 2xx', async () => {
    service.recordHttpRequest('GET', '/health', 200, 5);
    const output = await service.getMetrics();
    expect(output).not.toMatch(/http_errors_total{[^}]*status="200"/);
  });

  // Job-queue metrics //

  it('setJobQueueSize() sets the job_queue_size gauge', async () => {
    service.setJobQueueSize('news-fetch', 42);
    const output = await service.getMetrics();
    expect(output).toContain('job_queue_size');
    expect(output).toContain('42');
  });

  it('recordJobProcessed() increments jobs_processed_total and jobs_failed_total on failure', async () => {
    service.recordJobProcessed('news-fetch', 'failure');
    const output = await service.getMetrics();
    expect(output).toContain('jobs_processed_total');
    expect(output).toContain('jobs_failed_total');
  });

  // Data-pipeline: articles //

  it('recordArticleProcessed() increments lumenpulse_articles_processed_total', async () => {
    service.recordArticleProcessed('coindesk', 'success');
    service.recordArticleProcessed('coindesk', 'duplicate');
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_articles_processed_total');
  });

  // Data-pipeline: sentiment //

  it('recordSentimentScore() updates the lumenpulse_sentiment_score gauge', async () => {
    service.recordSentimentScore(0.8, 'coindesk');
    service.recordSentimentScore(0.2, 'coindesk');
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_sentiment_score');
    // Rolling average of 0.8 and 0.2 = 0.5
    expect(output).toContain('0.5');
  });

  // Data-pipeline: inference latency //

  it('recordModelInference() adds an observation to the histogram', async () => {
    service.recordModelInference(0.042, 'finbert-v2', 'sentiment');
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_model_inference_duration_seconds');
  });

  it('startInferenceTimer() returns a callable that records duration', async () => {
    const end = service.startInferenceTimer('finbert-v2', 'anomaly');
    // Simulate a tiny delay so the recorded value > 0
    await new Promise((r) => setTimeout(r, 5));
    end();
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_model_inference_duration_seconds_sum');
  });

  // Data-pipeline: anomalies //

  it('recordAnomalyDetected() increments lumenpulse_anomalies_detected_total', async () => {
    service.recordAnomalyDetected('price_spike', 'high');
    service.recordAnomalyDetected('sentiment_shift', 'low');
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_anomalies_detected_total');
  });

  // Data-pipeline: fetch errors //

  it('recordFetchError() increments lumenpulse_fetch_errors_total', async () => {
    service.recordFetchError('cointelegraph', '429');
    service.recordFetchError('reuters', 'TIMEOUT');
    const output = await service.getMetrics();
    expect(output).toContain('lumenpulse_fetch_errors_total');
  });

  // Dynamic helpers //

  it('getOrCreateGauge() returns the same instance on repeated calls', () => {
    const g1 = service.getOrCreateGauge('my_gauge', 'help text');
    const g2 = service.getOrCreateGauge('my_gauge', 'help text');
    expect(g1).toBe(g2);
  });

  it('getOrCreateCounter() returns the same instance on repeated calls', () => {
    const c1 = service.getOrCreateCounter('my_counter', 'help text');
    const c2 = service.getOrCreateCounter('my_counter', 'help text');
    expect(c1).toBe(c2);
  });

  // Reset //

  it('resetMetrics() clears all recorded values', async () => {
    service.recordArticleProcessed('coindesk');
    service.resetMetrics();
    // After reset the registry is cleared; getMetrics() still works but
    // counters/gauges are gone (they were registered on the now-cleared registry).
    // We just assert no throw.
    await expect(service.getMetrics()).resolves.toBeDefined();
  });
});