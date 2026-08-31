import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthContext';
import { getNotifications, markAsRead as markAsReadApi } from '../lib/notifications-api';
import { getStableDeviceId, registerPushToken, deregisterCurrentDevice } from '../lib/push-token';

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
  notificationListener: Notifications.Subscription | null;
  responseListener: Notifications.Subscription | null;
  registrationStatus: 'idle' | 'registering' | 'registered' | 'error';
  registrationError: string | null;
  retryRegistration: () => Promise<string | null>;
  deregisterDevice: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [registrationStatus, setRegistrationStatus] = useState<
    'idle' | 'registering' | 'registered' | 'error'
  >('idle');
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getNotifications();
      setNotifications(data as Notification[]);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  const registerForPushNotificationsAsync = useCallback(async () => {
    if (!Device.isDevice || !isAuthenticated) return null;
    setRegistrationStatus('registering');
    setRegistrationError(null);
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        throw new Error('Push notification permission was not granted');
      }
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      const deviceId = await getStableDeviceId();
      const platform = Device.osName?.toLowerCase().includes('ios') ? 'ios' : 'android';
      let lastError = 'Unable to register push token';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await registerPushToken({
          token,
          deviceId,
          platform,
          deviceName: Device.deviceName ?? undefined,
        });
        if (response.success) {
          setRegistrationStatus('registered');
          return token;
        }
        lastError = response.error?.message ?? lastError;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
      throw new Error(lastError);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to register push token';
      setRegistrationStatus('error');
      setRegistrationError(message);
      return null;
    }
  }, [isAuthenticated]);

  const deregisterDevice = useCallback(async () => {
    if (!isAuthenticated) return;
    await deregisterCurrentDevice();
    setRegistrationStatus('idle');
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      void fetchNotifications();
      void registerForPushNotificationsAsync();
    }
    const tokenRefreshListener = Notifications.addPushTokenListener(() => {
      if (isAuthenticated) void registerForPushNotificationsAsync();
    });

    // Clean up listeners on unmount
    return () => {
      if (notificationListenerRef.current) {
        notificationListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
      tokenRefreshListener.remove();
    };
  }, [fetchNotifications, isAuthenticated, registerForPushNotificationsAsync]);

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
        responseListener: responseListenerRef.current,
        registrationStatus,
        registrationError,
        retryRegistration: registerForPushNotificationsAsync,
        deregisterDevice,
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
