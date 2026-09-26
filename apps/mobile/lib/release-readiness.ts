// Release readiness signal derived from crash-free rates (Issue #1414).
// Thresholds are the single source of truth the release checklist references.
export const CRASH_FREE_SESSION_THRESHOLD = 0.99;
export const CRASH_FREE_USER_THRESHOLD = 0.98;

export interface CrashFreeRates {
  releaseVersion: string;
  crashFreeSessionRate: number;
  crashFreeUserRate: number;
}
export interface ReleaseReadiness {
  releaseVersion: string;
  ready: boolean;
  reason: string;
}

/** Pure function: no I/O, so it can be driven by live rates or fixtures. */
export function evaluateReleaseReadiness(
  rates: CrashFreeRates,
  sessionThreshold: number = CRASH_FREE_SESSION_THRESHOLD,
  userThreshold: number = CRASH_FREE_USER_THRESHOLD,
): ReleaseReadiness {
  const { releaseVersion, crashFreeSessionRate, crashFreeUserRate } = rates;
  let reason = 'meets crash-free thresholds';
  let ready = true;

  if (crashFreeSessionRate < sessionThreshold) {
    ready = false;
    reason = `session rate ${crashFreeSessionRate} below threshold ${sessionThreshold}`;
  } else if (crashFreeUserRate < userThreshold) {
    ready = false;
    reason = `user rate ${crashFreeUserRate} below threshold ${userThreshold}`;
  }

  return { releaseVersion, ready, reason };
}
