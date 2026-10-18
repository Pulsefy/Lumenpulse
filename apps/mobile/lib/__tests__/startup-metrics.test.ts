import {
  getStartupMetrics,
  markStartupPhase,
  markTimeToInteractive,
  resetStartupMetricsForTests,
} from '../startup-metrics';

describe('startup-metrics', () => {
  beforeEach(() => {
    resetStartupMetricsForTests();
  });

  it('records time-to-interactive relative to the first mark', () => {
    markStartupPhase('jsEvaluated');
    markStartupPhase('firstRender');
    markTimeToInteractive();

    const snapshot = getStartupMetrics();
    expect(snapshot.timeToInteractiveMs).not.toBeNull();
    expect(snapshot.timeToInteractiveMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.phases.timeToInteractive).toBeDefined();
  });

  it('publishes on globalThis for the startup E2E spec', () => {
    markStartupPhase('jsEvaluated');
    const g = globalThis as { __LUMENPULSE_STARTUP__?: ReturnType<typeof getStartupMetrics> };
    expect(g.__LUMENPULSE_STARTUP__).toBeDefined();
  });
});
