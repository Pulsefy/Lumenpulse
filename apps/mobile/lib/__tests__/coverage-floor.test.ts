import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { getBiometricLockEnabled, setBiometricLockEnabled, isBiometricLockSupported, requireBiometricConfirmation } from '../biometric-lock';

describe('biometric lock helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the enabled preference from secure storage', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('true');

    await expect(getBiometricLockEnabled()).resolves.toBe(true);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('biometric_lock_enabled');
  });

  it('persists the enabled preference to secure storage', async () => {
    await setBiometricLockEnabled(true);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('biometric_lock_enabled', 'true');
  });

  it('returns false when the device has no biometric hardware', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);

    await expect(isBiometricLockSupported()).resolves.toBe(false);
  });

  it('allows the action through when no biometric support is present', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock).mockResolvedValue([]);

    await expect(requireBiometricConfirmation('Confirm access')).resolves.toBe(true);
  });
});
