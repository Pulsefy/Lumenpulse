import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export interface LoadTestConfig {
  baseUrl: string;
  durationSeconds: number;
  concurrency: number;
  rampUpSeconds?: number;
}

export interface RequestMetrics {
  durationMs: number;
  statusCode: number;
  isError: boolean;
  endpoint: string;
}

export interface Scenario {
  name: string;
  weight: number; // percentage (0 - 100)
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

export const DEFAULT_SCENARIOS: Scenario[] = [
  // 40% Reads
  { name: 'Read News Feed', weight: 20, path: '/v1/news', method: 'GET' },
  { name: 'Read Market Stats', weight: 20, path: '/v1/portfolio/stats', method: 'GET' },

  // 30% Search
  { name: 'Search Projects', weight: 20, path: '/v1/search/projects?q=soroban', method: 'GET' },
  { name: 'Search Contributors', weight: 10, path: '/v1/search/contributors?q=stellar', method: 'GET' },

  // 20% Auth / Dashboard
  { name: 'Dashboard Overview', weight: 10, path: '/v1/dashboard/summary', method: 'GET' },
  { name: 'User Profile Check', weight: 10, path: '/v1/users/me', method: 'GET' },

  // 10% Mutations
  {
    name: 'Create Saved Search',
    weight: 10,
    path: '/v1/saved-searches',
    method: 'POST',
    body: JSON.stringify({ query: 'soroban', category: 'smart-contracts' }),
    headers: { 'Content-Type': 'application/json' },
  },
];

export class LoadHarness {
  private metrics: RequestMetrics[] = [];
  private isRunning = false;

  constructor(
    private readonly config: LoadTestConfig,
    private readonly scenarios: Scenario[] = DEFAULT_SCENARIOS,
  ) {}

  private pickScenario(): Scenario {
    const roll = Math.random() * 100;
    let accumulated = 0;
    for (const scenario of this.scenarios) {
      accumulated += scenario.weight;
      if (roll <= accumulated) return scenario;
    }
    return this.scenarios[0];
  }

  private sendRequest(scenario: Scenario): Promise<RequestMetrics> {
    const start = Date.now();
    const url = new URL(scenario.path, this.config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    return new Promise((resolve) => {
      const req = client.request(
        url,
        {
          method: scenario.method,
          headers: {
            'User-Agent': 'LumenPulse-LoadHarness/1.0',
            ...scenario.headers,
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const durationMs = Date.now() - start;
            resolve({
              durationMs,
              statusCode: res.statusCode || 500,
              isError: (res.statusCode || 500) >= 400,
              endpoint: scenario.path,
            });
          });
        },
      );

      req.on('error', () => {
        resolve({
          durationMs: Date.now() - start,
          statusCode: 0,
          isError: true,
          endpoint: scenario.path,
        });
      });

      if (scenario.body) {
        req.write(scenario.body);
      }
      req.end();
    });
  }

  private async worker(stopTime: number): Promise<void> {
    while (this.isRunning && Date.now() < stopTime) {
      const scenario = this.pickScenario();
      const metric = await this.sendRequest(scenario);
      this.metrics.push(metric);
    }
  }

  async run(): Promise<LoadTestSummary> {
    this.metrics = [];
    this.isRunning = true;
    const startTime = Date.now();
    const stopTime = startTime + this.config.durationSeconds * 1000;

    const workers = Array.from({ length: this.config.concurrency }, () =>
      this.worker(stopTime),
    );

    await Promise.all(workers);
    this.isRunning = false;
    const totalTimeSec = (Date.now() - startTime) / 1000;

    return this.calculateSummary(totalTimeSec);
  }

  private calculateSummary(totalTimeSec: number): LoadTestSummary {
    const totalRequests = this.metrics.length;
    const errors = this.metrics.filter((m) => m.isError).length;
    const latencies = this.metrics.map((m) => m.durationMs).sort((a, b) => a - b);

    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    return {
      totalRequests,
      durationSeconds: totalTimeSec,
      requestsPerSecond: Math.round((totalRequests / totalTimeSec) * 10) / 10,
      errorRate: Math.round((errors / Math.max(1, totalRequests)) * 10000) / 100,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
    };
  }
}

export interface LoadTestSummary {
  totalRequests: number;
  durationSeconds: number;
  requestsPerSecond: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

// CLI runner
if (require.main === module) {
  const target = process.env.LOAD_TEST_TARGET || 'http://localhost:3000';
  const duration = parseInt(process.env.LOAD_TEST_DURATION || '10', 10);
  const concurrency = parseInt(process.env.LOAD_TEST_CONCURRENCY || '25', 10);

  console.log(`Starting load test against ${target} with ${concurrency} concurrent workers for ${duration}s...`);

  const harness = new LoadHarness({
    baseUrl: target,
    durationSeconds: duration,
    concurrency,
  });

  harness.run().then((summary) => {
    console.log('-----------------------------------------');
    console.log('Load Test Results');
    console.log('-----------------------------------------');
    console.log(`Total Requests:    ${summary.totalRequests}`);
    console.log(`Throughput:        ${summary.requestsPerSecond} req/s`);
    console.log(`Error Rate:        ${summary.errorRate}%`);
    console.log(`p50 Latency:       ${summary.p50LatencyMs} ms`);
    console.log(`p95 Latency:       ${summary.p95LatencyMs} ms`);
    console.log(`p99 Latency:       ${summary.p99LatencyMs} ms`);
    console.log('-----------------------------------------');
  });
}
