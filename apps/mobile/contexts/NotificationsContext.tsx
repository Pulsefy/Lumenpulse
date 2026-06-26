import { getNotifications, markAsRead as markAsReadApi } from '@/lib/notifications';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';

export type Notification = {
  id: number;
  title: string;
  message: string;
  read: boolean;
  data?: {
    type?: string;
    id?: string | number;
    [key: string]: any;
  };
};

type NotificationsContextType = {
  notifications: Notification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  registerForPushNotificationsAsync: () => Promise<string | null>;
  handleNotification: (notification: Notifications.Notification) => void;
  notificationListener: Notifications.Subscription;
  responseListener: Notifications.Subscription;
};

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);
  const router = useRouter();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getNotifications('/notifications');
      setNotifications(data);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  const registerForPushNotificationsAsync = useCallback(async () => {
    if (!Device.isDevice) {
      alert('Must use physical device for push notifications');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      alert('Failed to get push token for push notification!');
      return null;
    }
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log('Push token:', token);
    return token;
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Register for push notifications
    registerForPushNotificationsAsync();

    // Clean up listeners on unmount
    return () => {
      if (notificationListenerRef.current) {
        notificationListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [fetchNotifications, registerForPushNotificationsAsync]);

  const handleNotification = useCallback((notification: Notifications.Notification) => {
    // When a notification is received while the app is in foreground
    // We'll add it to our notifications list
    const { title, body, data } = notification.request.content;

    // Create a new notification object
    const newNotification: Notification = {
      id: Date.now(), // Temporary ID, will be replaced when fetched from server
      title: title ?? 'Notification',
      message: body ?? '',
      read: false,
      data: data || {},
    };

    // Add to notifications list
    setNotifications((prev) => [newNotification, ...prev]);

    // If the app is in foreground, we might want to show an alert or handle differently
    // For now, we'll just add it to the list

    // If notification data contains deep link info, we could navigate here
    // but typically we handle navigation when user taps the notification
  }, []);

  const markAsRead = useCallback(async (id: number) => {
    // Update local state first
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

    try {
      // Call API to mark as read
      await markAsReadApi(id);
    } catch (err) {
      console.error('Failed to mark as read:', err);
      // Revert local state on failure
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    // Update local state first
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    try {
      // Call API to mark all as read
      // await Promise.all(notifications.filter(n => !n.read).map(n => markAsReadApi(n.id)));
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      // Revert local state on failure
      setNotifications((prev) => prev.map((n) => ({ ...n, read: false })));
    }
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Listen for incoming notifications (when app is in foreground)
    notificationListenerRef.current =
      Notifications.addNotificationReceivedListener(handleNotification);

    // Listen for notification responses (when user taps on notification)
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const { notification } = response;
        const { data } = notification.request.content;

        // Handle deep linking based on notification data
        if (data) {
          // Example: if notification data contains a screen to navigate to
          if (typeof data.screen === 'string') {
            router.push(data.screen as any);
          } else if (data.type === 'alert' && data.alertId) {
            // Navigate to alert details screen
            router.push(`/alerts/${data.alertId}` as any);
          } else if (data.type === 'transaction' && data.transactionId) {
            // Navigate to transaction details screen
            router.push(`/transactions/${data.transactionId}` as any);
          }
          // Add more deep link handling as needed
        }
      },
    );

    // Clean up listeners on unmount
    return () => {
      if (notificationListenerRef.current) {
        notificationListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [handleNotification, router]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        registerForPushNotificationsAsync,
        handleNotification,
        notificationListener: notificationListenerRef.current!,
        responseListener: responseListenerRef.current!,
      }}
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
