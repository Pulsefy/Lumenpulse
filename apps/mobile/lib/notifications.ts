import { apiClient, ApiResponse } from './api-client';

export interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'price_alert' | 'news_alert' | 'security_alert' | 'account_activity';
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * Notifications API Service
 */
export const notificationsApi = {
  /**
   * Get all notifications for the authenticated user
   */
  async getNotifications(): Promise<ApiResponse<Notification[]>> {
    return apiClient.get<Notification[]>('/notifications');
  },

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<ApiResponse<{ unreadCount: number }>> {
    return apiClient.get<{ unreadCount: number }>('/notifications/unread-count');
  },

  /**
   * Mark a single notification as read
   */
  async markAsRead(id: number): Promise<ApiResponse<{ id: number; read: boolean }>> {
    return apiClient.post<{ id: number; read: boolean }>(`/notifications/${id}/read`);
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post<{ success: boolean }>('/notifications/mark-all-read');
  },
};