/* eslint-disable prettier/prettier */
import { getNotifications, markAsRead as markAsReadApi } from '@/lib/notifications';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { parseDeepLinkFromData, navigateToDeepLink, DeepLinkData } from '@/lib/deep-link';
import { pushNotificationApi } from '@/lib/push-notification-api';

// ---------------------------------------------------------------------------
// Configure how notifications appear when the app is in the foreground
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type Notification = {
  id: number;
  title: string;
  message: string;
  read: boolean;
  data?: {
    type?: string;
    id?: string | number;
    deepLink?: DeepLinkData;
    [key: string]: any;
  };
};

type ForegroundBanner = {
  title: string;
  body: string;
  deepLink: DeepLinkData | null;
  timestamp: number;
};

type NotificationsContextType = {
  notifications: Notification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  registerForPushNotificationsAsync: () => Promise<string | null>;
  handleNotification: (notification: Notifications.Notification) => void;
  foregroundBanner: ForegroundBanner | null;
  dismissBanner: () => void;
  notificationListener: Notifications.Subscription;
  responseListener: Notifications.Subscription;
};

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [foregroundBanner, setForegroundBanner] = useState<ForegroundBanner | null>(null);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);
  const pendingDeepLinkRef = useRef<DeepLinkData | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const router = useRouter();

  const unreadCount = notifications.filter((n: Notification) => !n.read).length;

  const dismissBanner = useCallback(() => {
    setForegroundBanner(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Cold-start deep link handler
  // ---------------------------------------------------------------------------
  // When the app is launched from a terminated state via notification tap,
  // the notification response is available via getInitialNotification().
  // We store it and process once the router is ready.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const initialResponse = await Notifications.getLastNotificationResponseAsync();
        if (!mounted || !initialResponse) return;

        const { data } = initialResponse.notification.request.content;
        if (data) {
          const deepLink = parseDeepLinkFromData(data as Record<string, unknown>);
          if (deepLink) {
            // Delay slightly so the router has time to mount
            pendingDeepLinkRef.current = deepLink;
            setTimeout(() => {
              if (pendingDeepLinkRef.current) {
                navigateToDeepLink(pendingDeepLinkRef.current, router);
                pendingDeepLinkRef.current = null;
              }
            }, 500);
          }
        }
      } catch (err) {
        console.error('[ColdStart] Failed to get initial notification:', err);
      }
    })();

    return () => { mounted = false; };
  }, [router]);

  // ---------------------------------------------------------------------------
  // Track app state transitions (foreground/background)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: string) => {
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getNotifications('/notifications');
      setNotifications(data);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Register for push notifications and send token to backend
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
  }, [fetchNotifications]);

  // ---------------------------------------------------------------------------
  // Push notification registration — sends token to backend
  // ---------------------------------------------------------------------------
  const registerForPushNotificationsAsync = useCallback(async (): Promise<string | null> => {
    if (!Device.isDevice) {
      console.warn('[Push] Push notifications require a physical device');
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.warn('[Push] Notification permission not granted');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'lumenpulse',
      });
      const token = tokenData.data;
      console.log('[Push] Expo push token:', token);

      // Register token with backend
      try {
        await pushNotificationApi.registerDevice({
          token,
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
          deviceName: Device.modelName || undefined,
        });
        console.log('[Push] Token registered with backend');
      } catch (err) {
        console.error('[Push] Failed to register token with backend:', err);
        // Non-fatal — the app still works, just won't receive server-side pushes
      }

      // Set up Android notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      return token;
    } catch (err) {
      console.error('[Push] Failed to register for push notifications:', err);
      return null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Foreground notification handler — shows banner + adds to list
  // ---------------------------------------------------------------------------
  const handleNotification = useCallback(
    (notification: Notifications.Notification) => {
      const { title, body, data } = notification.request.content;

      // Parse deep link from the notification data
      const deepLink = data
        ? parseDeepLinkFromData(data as Record<string, unknown>)
        : null;

      // Create a new notification object for the local list
      const newNotification: Notification = {
        id: Date.now(),
        title: title ?? 'Notification',
        message: body ?? '',
        read: false,
        data: {
          ...(data as Record<string, unknown> | undefined),
          deepLink: deepLink || undefined,
        },
      };

      // Add to notifications list
      setNotifications((prev: Notification[]) => [newNotification, ...prev]);

      // Show a foreground banner that the user can tap to navigate
      if (appStateRef.current === 'active') {
        setForegroundBanner({
          title: title ?? 'Notification',
          body: body ?? '',
          deepLink,
          timestamp: Date.now(),
        });

        // Auto-dismiss banner after 8 seconds
        setTimeout(() => {
          setForegroundBanner((prev: ForegroundBanner | null) =>
            prev?.timestamp === newNotification.id ? null : prev,
          );
        }, 8000);
      }
    },
    [],
  );

  const markAsRead = useCallback(async (id: number) => {
    setNotifications((prev: Notification[]) => prev.map((n: Notification) => (n.id === id ? { ...n, read: true } : n)));

    try {
      await markAsReadApi(id);
    } catch (err) {
      console.error('Failed to mark as read:', err);
      setNotifications((prev: Notification[]) => prev.map((n: Notification) => (n.id === id ? { ...n, read: false } : n)));
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev: Notification[]) => prev.map((n: Notification) => ({ ...n, read: true })));

    try {
      // await Promise.all(notifications.filter(n => !n.read).map(n => markAsReadApi(n.id)));
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      setNotifications((prev: Notification[]) => prev.map((n: Notification) => ({ ...n, read: false })));  
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Notification response (tap) listener — handles background + foreground taps
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Listen for incoming notifications when the app is in the foreground
    notificationListenerRef.current =
      Notifications.addNotificationReceivedListener(handleNotification);

    // Listen for notification taps (background + foreground)
    responseListenerRef.current =
      Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
        const { data } = response.notification.request.content;

        // Dismiss any foreground banner
        setForegroundBanner(null);

        if (!data) return;

        // Parse the deep link from the notification payload
        const deepLink = parseDeepLinkFromData(data as Record<string, unknown>);
        if (deepLink) {
          navigateToDeepLink(deepLink, router);
        }
      });

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
        foregroundBanner,
        dismissBanner,
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
