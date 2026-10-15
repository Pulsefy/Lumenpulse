import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { LatencyBudgetHealthService } from './latency-budget.health.service';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('LatencyBudgetHealthService', () => {
  let service: LatencyBudgetHealthService;
  let httpService: { get: jest.Mock; post: jest.Mock };

  beforeEach(async () => {
    httpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LatencyBudgetHealthService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<LatencyBudgetHealthService>(
      LatencyBudgetHealthService,
    );

    // Restore original env so tests are isolated
    delete process.env.HEALTH_HORIZON_LATENCY_DEGRADED_MS;
    delete process.env.HEALTH_HORIZON_LATENCY_HARD_DOWN_MS;
    delete process.env.HEALTH_SOROBAN_RPC_LATENCY_DEGRADED_MS;
    delete process.env.HEALTH_SOROBAN_RPC_LATENCY_HARD_DOWN_MS;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns overallState=ok when both probes respond quickly', async () => {
    httpService.get.mockReturnValue(of({ data: {}, status: 200 }));
    httpService.post.mockReturnValue(
      of({ data: { result: { status: 'healthy' } }, status: 200 }),
    );

    const report = await service.getLatencyBudgetReport();

    expect(report.overallState).toBe('ok');
    expect(report.dependencies).toHaveLength(2);
    expect(report.dependencies.every((d) => d.state === 'ok')).toBe(true);
  });

  it('includes checkedAt as an ISO date string', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));
    httpService.post.mockReturnValue(of({ data: {} }));

    const report = await service.getLatencyBudgetReport();

    expect(() => new Date(report.checkedAt)).not.toThrow();
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
  });

  // ── Hard-down: connection failure ──────────────────────────────────────────

  it('classifies horizon as hard_down when the HTTP probe throws', async () => {
    httpService.get.mockReturnValue(
      throwError(() => new Error('ECONNREFUSED')),
    );
    httpService.post.mockReturnValue(of({ data: {} }));

    const report = await service.getLatencyBudgetReport();
    const horizon = report.dependencies.find((d) => d.name === 'horizon')!;

    expect(horizon.state).toBe('hard_down');
    expect(horizon.message).toContain('ECONNREFUSED');
    expect(report.overallState).toBe('hard_down');
  });

  it('classifies sorobanRpc as hard_down when the RPC probe throws', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));
    httpService.post.mockReturnValue(
      throwError(() => new Error('socket hang up')),
    );

    const report = await service.getLatencyBudgetReport();
    const rpc = report.dependencies.find((d) => d.name === 'sorobanRpc')!;

    expect(rpc.state).toBe('hard_down');
    expect(report.overallState).toBe('hard_down');
  });

  // ── Overall state rollup ───────────────────────────────────────────────────

  it('reports overallState=hard_down even when one dep is ok', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));
    httpService.post.mockReturnValue(throwError(() => new Error('timeout')));

    const report = await service.getLatencyBudgetReport();

    expect(report.overallState).toBe('hard_down');
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  it('includes url and thresholds in each dependency result', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));
    httpService.post.mockReturnValue(of({ data: {} }));

    const report = await service.getLatencyBudgetReport();

    for (const dep of report.dependencies) {
      expect(dep.url).toBeTruthy();
      expect(dep.thresholds).toMatchObject({
        degradedMs: expect.any(Number),
        hardDownMs: expect.any(Number),
      });
      expect(dep.latencyMs).toBeDefined();
    }
  });

  it('names the two dependencies "horizon" and "sorobanRpc"', async () => {
    httpService.get.mockReturnValue(of({ data: {} }));
    httpService.post.mockReturnValue(of({ data: {} }));

    const report = await service.getLatencyBudgetReport();
    const names = report.dependencies.map((d) => d.name);

    expect(names).toContain('horizon');
    expect(names).toContain('sorobanRpc');
  });

  // ── Error message handling ─────────────────────────────────────────────────

  it('captures non-Error thrown values as a string message', async () => {
    httpService.get.mockReturnValue(throwError(() => 'raw string error'));
    httpService.post.mockReturnValue(of({ data: {} }));

    const report = await service.getLatencyBudgetReport();
    const horizon = report.dependencies.find((d) => d.name === 'horizon')!;

    expect(horizon.state).toBe('hard_down');
    expect(horizon.message).toBe('raw string error');
  });
});
