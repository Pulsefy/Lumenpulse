/**
 * Cold / warm startup instrumentation (issue #1576).
 *
 * Marks are monotonic wall-clock ms from the first `jsEvaluated` mark. The Expo
 * web E2E suite reads `globalThis.__LUMENPULSE_STARTUP__` on a throttled
 * low-end profile; native builds use the same marks for local profiling.
 */

export type StartupPhase =
  | 'jsEvaluated'
  | 'rootLayoutMounted'
  | 'firstRender'
  | 'timeToInteractive';

export interface StartupMetricsPublic {
  readonly phases: Readonly<Record<StartupPhase, number | undefined>>;
  readonly timeToInteractiveMs: number | null;
  readonly profile: 'low-end-web' | 'unknown';
}

const phases: Partial<Record<StartupPhase, number>> = {};
let originMs: number | null = null;

function now(): number {
  return Date.now();
}

export function markStartupPhase(phase: StartupPhase): void {
  const t = now();
  if (originMs === null) {
    originMs = t;
  }
  phases[phase] = t;
  publish();
}

export function markTimeToInteractive(): void {
  markStartupPhase('timeToInteractive');
}

export function getStartupMetrics(): StartupMetricsPublic {
  const base = originMs ?? now();
  const tti = phases.timeToInteractive;
  return {
    phases: {
      jsEvaluated: phases.jsEvaluated,
      rootLayoutMounted: phases.rootLayoutMounted,
      firstRender: phases.firstRender,
      timeToInteractive: phases.timeToInteractive,
    },
    timeToInteractiveMs: tti != null ? tti - base : null,
    profile: 'unknown',
  };
}

export function resetStartupMetricsForTests(): void {
  for (const key of Object.keys(phases) as StartupPhase[]) {
    delete phases[key];
  }
  originMs = null;
  publish();
}

function publish(): void {
  const snapshot = getStartupMetrics();
  const g = globalThis as typeof globalThis & {
    __LUMENPULSE_STARTUP__?: StartupMetricsPublic;
  };
  g.__LUMENPULSE_STARTUP__ = snapshot;
}
