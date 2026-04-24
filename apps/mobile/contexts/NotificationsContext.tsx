/* eslint-disable prettier/prettier */
import { notificationsApi, Notification } from '@/lib/notifications';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

type NotificationsContextType = {
  notifications: Notification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await notificationsApi.getNotifications();
      if (response.success && response.data) {
        setNotifications(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (id: number) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    try {
      await notificationsApi.markAsRead(id);
    } catch (err) {
      console.error('Failed to mark as read:', err);
      // Rollback on failure
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false } : n))
      );
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await notificationsApi.markAllAsRead();
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      // Rollback on failure
      setNotifications((prev) => prev.map((n) => ({ ...n, read: false })));
    }
  }, []);

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, fetchNotifications, markAsRead, markAllAsRead }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}