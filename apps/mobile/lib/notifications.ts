import { apiClient } from './api-client';

export interface NotificationRecord {
  id: number;
  title: string;
  message: string;
  read: boolean;
  data?: Record<string, unknown>;
}

export async function getNotifications(): Promise<NotificationRecord[]> {
  const response = await apiClient.get<NotificationRecord[]>('/notifications');
  return response.success ? (response.data ?? []) : [];
}

export async function markAsRead(id: number): Promise<boolean> {
  const response = await apiClient.post<void>(`/notifications/${id}/read`);
  return response.success;
}
