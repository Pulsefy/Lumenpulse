import {
  SessionTimeoutManager,
  DEFAULT_SESSION_TIMEOUT_MS,
  MIN_SESSION_TIMEOUT_MS,
  MAX_SESSION_TIMEOUT_MS,
  BACKGROUND_LOCK_THRESHOLD_MS,
  clampInactivityTimeout,
} from './session-timeout';

describe('SessionTimeoutManager', () => {
  const OriginalDateNow = Date.now;
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 1_000_000;
    Date.now = () => nowMs;
  });

  afterEach(() => {
    Date.now = OriginalDateNow;
  });

  it('starts unlocked with the default timeout', () => {
    const manager = new SessionTimeoutManager();
    expect(manager.isLocked()).toBe(false);
    expect(manager.getPolicy().inactivityTimeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
  });

  it('locks after the inactivity timeout elapses', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 60_000,
      backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
    });
    nowMs += 59_999;
    expect(manager.evaluate()).toBe(false);
    nowMs += 2;
    expect(manager.evaluate()).toBe(true);
    expect(manager.isLocked()).toBe(true);
  });

  it('resets the inactivity timer on recorded activity', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 60_000,
      backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
    });
    nowMs += 50_000;
    manager.recordActivity();
    nowMs += 50_000;
    expect(manager.evaluate()).toBe(false);
  });

  it('locks on return after backgrounding beyond the threshold', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 10_000,
      backgroundLockThresholdMs: 30_000,
    });
    manager.handleAppStateChange('background');
    nowMs += 31_000;
    manager.handleAppStateChange('active');
    expect(manager.isLocked()).toBe(true);
  });

  it('does not lock on return after brief backgrounding within threshold', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 10_000,
      backgroundLockThresholdMs: 30_000,
    });
    manager.handleAppStateChange('background');
    nowMs += 5_000;
    manager.handleAppStateChange('active');
    expect(manager.isLocked()).toBe(false);
  });

  it('notifies listeners when locking and stops after unsubscribe', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 1_000,
      backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
    });
    const listener = jest.fn();
    const unsubscribe = manager.onLock(listener);
    nowMs += 2_000;
    manager.evaluate();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    manager.unlock();
    nowMs += 2_000;
    manager.evaluate();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets the lock state on unlock', () => {
    const manager = new SessionTimeoutManager({
      inactivityTimeoutMs: 1_000,
      backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
    });
    nowMs += 2_000;
    manager.evaluate();
    expect(manager.isLocked()).toBe(true);
    manager.unlock();
    expect(manager.isLocked()).toBe(false);
    expect(manager.evaluate()).toBe(false);
  });

  it('updates the policy through setPolicy', () => {
    const manager = new SessionTimeoutManager();
    manager.setPolicy({ inactivityTimeoutMs: 2_000 });
    expect(manager.getPolicy().inactivityTimeoutMs).toBe(2_000);
    nowMs += 2_000;
    expect(manager.evaluate()).toBe(true);
  });
});

describe('clampInactivityTimeout', () => {
  it('enforces the minimum bound', () => {
    expect(clampInactivityTimeout(1)).toBe(MIN_SESSION_TIMEOUT_MS);
  });

  it('enforces the maximum bound', () => {
    expect(clampInactivityTimeout(Number.MAX_VALUE)).toBe(
      MAX_SESSION_TIMEOUT_MS,
    );
  });

  it('passes through values within bounds', () => {
    expect(clampInactivityTimeout(60_000)).toBe(60_000);
  });

  it('falls back to the default for invalid values', () => {
    expect(clampInactivityTimeout(NaN)).toBe(
      DEFAULT_SESSION_TIMEOUT_MS,
    );
  });
});
