import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { apiClient, ApiResponse } from './api-client';

const DEVICE_ID_KEY = 'lumenpulse.push.device-id';

export type PushTokenPlatform = 'ios' | 'android' | 'web';

export interface RegisterPushTokenPayload {
  token: string;
  deviceId: string;
  platform: PushTokenPlatform;
  deviceName?: string;
}

const createDeviceId = (): string =>
  `${Device.osName ?? 'unknown'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export async function getStableDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = createDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export async function registerPushToken(
  payload: RegisterPushTokenPayload,
): Promise<ApiResponse<void>> {
  return apiClient.post<void>('/notification-devices', payload);
}

export async function deregisterPushToken(deviceId: string): Promise<ApiResponse<void>> {
  return apiClient.deleteWithBody<void>('/notification-devices', { deviceId });
}

export async function deregisterCurrentDevice(): Promise<void> {
  const deviceId = await getStableDeviceId();
  const response = await deregisterPushToken(deviceId);
  if (!response.success) throw new Error(response.error?.message ?? 'Unable to deregister device');
}
