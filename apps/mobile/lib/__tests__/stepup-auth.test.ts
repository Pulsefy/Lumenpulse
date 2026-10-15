let Platform: typeof import('react-native').Platform;
let originalPlatformOS: typeof import('react-native').Platform.OS;
let LocalAuthentication: typeof import('expo-local-authentication');
let requireStepUpAuthentication: typeof import('../biometric-lock').requireStepUpAuthentication;

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(),
}));

describe('biometric-lock step-up mechanism', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    Platform = require('react-native').Platform;
    originalPlatformOS = Platform.OS;
    Platform.OS = 'ios';
    LocalAuthentication = require('expo-local-authentication');
    requireStepUpAuthentication = require('../biometric-lock').requireStepUpAuthentication;
  });

  afterEach(() => {
    jest.useRealTimers();
    Platform.OS = originalPlatformOS;
  });

  it('bypasses authentication on web platform', async () => {
    Platform.OS = 'web';
    const result = await requireStepUpAuthentication('Test', 300000);
    expect(result).toBe(true);
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it('prompts for authentication if outside grace period', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    const result = await requireStepUpAuthentication('Test', 300000);
    expect(result).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: 'Test',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      })
    );
  });

  it('respects the configurable grace period for subsequent calls', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });

    // First call authenticates
    await requireStepUpAuthentication('Test 1', 300000);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);

    // Advance time slightly, well within 5 mins
    jest.advanceTimersByTime(60000); // 1 min

    // Second call skips auth because of grace period
    const result = await requireStepUpAuthentication('Test 2', 300000);
    expect(result).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1); // Still 1

    // Advance time past the grace period
    jest.advanceTimersByTime(300000); // + 5 mins (total 6 mins)

    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    // Third call should authenticate again
    await requireStepUpAuthentication('Test 3', 300000);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
  });

  it('returns false if authentication is cancelled or fails', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: 'user_cancel' });

    // Attempt authentication (no previous successful auth due to resetModules)
    const result = await requireStepUpAuthentication('Test', 300000);
    expect(result).toBe(false);
  });
});
