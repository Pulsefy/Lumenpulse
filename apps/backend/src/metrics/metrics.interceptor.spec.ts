import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * Unit tests for MetricsInterceptor.
 *
 * Verifies that dynamic path segments — UUIDs, numeric IDs, Stellar wallet
 * addresses, contract IDs, hashes and other long machine-generated tokens —
 * are collapsed onto the `:id` route template so that the `route` label stays
 * bounded regardless of how many distinct identifiers hit the API.
 */
describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  const recordHttpRequest = jest.fn();

  beforeEach(async () => {
    recordHttpRequest.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsInterceptor,
        { provide: MetricsService, useValue: { recordHttpRequest } },
      ],
    }).compile();

    interceptor = module.get<MetricsInterceptor>(MetricsInterceptor);
  });

  /**
   * Drive a single request through the interceptor and resolve when the
   * underlying observable completes (i.e. after the metric was recorded).
   */
  const completeRequest = (
    path: string,
    method = 'GET',
    statusCode = 200,
  ): Promise<void> => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method, path }),
        getResponse: () => ({ statusCode }),
      }),
    };
    return new Promise<void>((resolve) => {
      interceptor
        .intercept(context as never, { handle: () => of(undefined) } as never)
        .subscribe({ complete: () => resolve() });
    });
  };

  it('records the normalized route for a UUID segment', async () => {
    await completeRequest('/users/550e8400-e29b-41d4-a716-446655440000');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/users/:id',
      200,
      expect.any(Number),
    );
  });

  it('records the normalized route for numeric segments', async () => {
    await completeRequest('/users/42/posts/7');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/users/:id/posts/:id',
      200,
      expect.any(Number),
    );
  });

  it('strips the query string before normalizing', async () => {
    await completeRequest('/articles/123?page=2&sort=desc');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/articles/:id',
      200,
      expect.any(Number),
    );
  });

  it('normalizes Stellar wallet addresses (G…)', async () => {
    // 56-char base32 StrKey: G + 55 base32 chars
    const address = `G${'A'.repeat(55)}`;
    await completeRequest(`/v1/portfolio/accounts/${address}/summary`);
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/v1/portfolio/accounts/:id/summary',
      200,
      expect.any(Number),
    );
  });

  it('normalizes Stellar contract IDs (C…)', async () => {
    const contractId = `C${'B'.repeat(55)}`;
    await completeRequest(`/v1/contracts/capabilities/${contractId}`);
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/v1/contracts/capabilities/:id',
      200,
      expect.any(Number),
    );
  });

  it('normalizes 64-char hex transaction hashes', async () => {
    const hash = 'a'.repeat(64);
    await completeRequest(`/transactions/${hash}`);
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/transactions/:id',
      200,
      expect.any(Number),
    );
  });

  it('normalizes other long machine-generated tokens', async () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnopqrstuvwx';
    await completeRequest(`/verification/submissions/${token}`);
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/verification/submissions/:id',
      200,
      expect.any(Number),
    );
  });

  it('preserves static route segments', async () => {
    await completeRequest('/news/coin/btc');
    await completeRequest('/metrics/health');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/news/coin/btc',
      200,
      expect.any(Number),
    );
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/metrics/health',
      200,
      expect.any(Number),
    );
  });

  it('preserves API version prefixes (v1, v12, …)', async () => {
    await completeRequest('/v1/config/stellar');
    await completeRequest('/v12/news');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/v1/config/stellar',
      200,
      expect.any(Number),
    );
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/v12/news',
      200,
      expect.any(Number),
    );
  });

  it('drops trailing slashes', async () => {
    await completeRequest('/users/42/');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/users/:id',
      200,
      expect.any(Number),
    );
  });

  it('maps the root path to "/"', async () => {
    await completeRequest('/');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/',
      200,
      expect.any(Number),
    );
  });

  it('records error responses using the thrown error status', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/users/42' }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(
          context as never,
          {
            handle: () =>
              throwError(
                () =>
                  Object.assign(new Error('rate limited'), {
                    status: 429,
                  }) as Error,
              ),
          } as never,
        )
        .subscribe({ error: () => resolve() });
    });
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'POST',
      '/users/:id',
      429,
      expect.any(Number),
    );
  });
});

/**
 * End-to-end scrape-payload measurement.
 *
 * Records the same traffic twice against a real MetricsService:
 *   - "before": raw request paths recorded verbatim (unbounded cardinality)
 *   - "after":  paths routed through the interceptor's route normalisation
 *
 * Asserts that the normalised payload is strictly smaller and that the number
 * of distinct `http_requests_total` series stays tiny no matter how many
 * distinct identifiers hit the API. The measured sizes are printed for the
 * PR description.
 */
describe('MetricsInterceptor scrape payload size', () => {
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  const base32String = (len: number, seed: number): string => {
    let out = '';
    let s = seed;
    for (let i = 0; i < len; i++) {
      s = (s * 31 + 7) % BASE32.length;
      out += BASE32[s];
    }
    return out;
  };

  const buildTraffic = (): string[] => {
    const paths: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const address = `G${base32String(55, i)}`;
      const contract = `C${base32String(55, i + 1000)}`;
      const hash = `${i.toString(16).padStart(64, '0')}`;
      paths.push(`/v1/portfolio/accounts/${address}/summary`);
      paths.push(`/v1/contracts/capabilities/${contract}`);
      paths.push(`/users/${i}`);
      paths.push(`/transactions/${hash}`);
      paths.push(`/crowdfund-sync/vaults/${contract}/stats`);
    }
    return paths;
  };

  const completeRequest = (
    interceptor: MetricsInterceptor,
    path: string,
  ): Promise<void> => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    return new Promise<void>((resolve) => {
      interceptor
        .intercept(context as never, { handle: () => of(undefined) } as never)
        .subscribe({ complete: () => resolve() });
    });
  };

  it('keeps the scrape payload small and the series count bounded', async () => {
    const traffic = buildTraffic();

    // "Before": raw paths recorded verbatim → one series per identifier
    const beforeService = new MetricsService();
    for (const path of traffic) {
      beforeService.recordHttpRequest('GET', path, 200, 5);
    }
    const beforePayload = await beforeService.getMetrics();
    const beforeBytes = Buffer.byteLength(beforePayload);

    // "After": same traffic routed through the normalising interceptor
    const afterService = new MetricsService();
    const afterInterceptor = new MetricsInterceptor(afterService);
    for (const path of traffic) {
      await completeRequest(afterInterceptor, path);
    }
    const afterPayload = await afterService.getMetrics();
    const afterBytes = Buffer.byteLength(afterPayload);

    // Distinct http_requests_total series in the normalized payload:
    // 5 distinct route templates × 1 method
    const afterSeries =
      afterPayload.match(/^http_requests_total\{[^}]*\}\s+\d+$/gm) ?? [];

    console.log(
      `scrape payload: before=${beforeBytes} bytes, after=${afterBytes} bytes ` +
        `(${((1 - afterBytes / beforeBytes) * 100).toFixed(1)}% reduction, ` +
        `${traffic.length} requests)`,
    );

    expect(afterBytes).toBeLessThan(beforeBytes);
    expect(afterSeries.length).toBeLessThanOrEqual(10);
    // Normalized payload should be at least an order of magnitude smaller
    expect(afterBytes).toBeLessThanOrEqual(beforeBytes / 10);
  });
});
