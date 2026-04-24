/**
 * Push Notification Device Registration API
 *
 * Handles registering/unregistering device push tokens
 * with the backend so it can send targeted push notifications.
 */

import { apiClient, ApiResponse } from './api-client';

export interface RegisterDevicePayload {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceName?: string;
}

export interface PushTokenResponse {
  id: string;
  token: string;
  platform: string;
  deviceName: string | null;
  isActive: boolean;
  createdAt: string;
}

export const pushNotificationApi = {
  /**
   * Register a device push token with the backend
   */
  async registerDevice(
    payload: RegisterDevicePayload,
  ): Promise<ApiResponse<PushTokenResponse>> {
    return apiClient.post<PushTokenResponse>(
      '/notifications/devices/register',
      payload,
    );
  },

  /**
   * Unregister a device push token from the backend
   */
  async unregisterDevice(token: string): Promise<ApiResponse<void>> {
    return apiClient.post<void>('/notifications/devices/unregister', { token });
  },

  /**
   * Get all registered devices for the current user
   */
  async getDevices(): Promise<ApiResponse<PushTokenResponse[]>> {
    return apiClient.get<PushTokenResponse[]>('/notifications/devices');
  },
};
