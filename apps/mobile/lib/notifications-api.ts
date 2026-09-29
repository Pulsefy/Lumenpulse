import { apiClient } from './api-client';

export async function getNotifications(): Promise<unknown[]> {
  const response = await apiClient.get<unknown[]>('/notifications');
  return response.success ? (response.data ?? []) : [];
}

export async function markAsRead(id: number): Promise<boolean> {
  const response = await apiClient.post<void>(`/notifications/${id}/read`);
  return response.success;
}
