import {
  evaluateDriftSeverity,
  ReconciliationThresholds,
} from './reconciliation.service';

describe('evaluateDriftSeverity', () => {
  const thresholds: ReconciliationThresholds = {
    warning: 1,
    critical: 5,
  };

  it.each([
    [0, 'none'],
    [0.999, 'none'],
    [1, 'warning'],
    [4.999, 'warning'],
    [5, 'critical'],
    [6, 'critical'],
  ])('classifies delta %p as %p', (delta, expected) => {
    expect(evaluateDriftSeverity(delta, thresholds)).toBe(expected);
  });
});