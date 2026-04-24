/**
 * Web Push Notification Subscription Service
 *
 * Handles browser push notification subscription, token registration
 * with the backend, and foreground notification display with deep links.
 */

export type DeepLinkScreen =
  | 'news_detail'
  | 'project_detail'
  | 'portfolio'
  | 'transaction_detail'
  | 'settings'
  | 'settings_notifications'
  | 'notifications_list'
  | 'asset_detail'
  | 'discover';

export interface DeepLinkData {
  screen: DeepLinkScreen;
  id?: string;
  params?: Record<string, unknown>;
}

export interface PushSubscriptionPayload {
  token: string;
  platform: 'web';
  deviceName?: string;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// VAPID key — must match the server's VAPID public key
// In production, set NEXT_PUBLIC_VAPID_PUBLIC_KEY env var
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if push notifications are supported in this browser
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Request notification permission from the user.
 * Returns the permission status.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) {
    console.warn('[WebPush] Push notifications not supported');
    return 'denied';
  }

  const result = await Notification.requestPermission();
  return result;
}

/**
 * Get the current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Subscribe to push notifications via the service worker's push manager.
 * Returns the push subscription endpoint, or null on failure.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    const existingSub = await registration.pushManager.getSubscription();
    if (existingSub) {
      return existingSub;
    }

    // Subscribe with VAPID key if available
    if (VAPID_PUBLIC_KEY) {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      });
      return subscription;
    }

    // Without VAPID, try applicationServerKey-less subscription
    console.warn('[WebPush] No VAPID key configured, push may not work');
    return null;
  } catch (err) {
    console.error('[WebPush] Failed to subscribe:', err);
    return null;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      return true;
    }
    return false;
  } catch (err) {
    console.error('[WebPush] Failed to unsubscribe:', err);
    return false;
  }
}

/**
 * Register the web push subscription with the backend.
 * Converts the PushSubscription to a token string and sends it
 * to the /notifications/devices/register endpoint.
 */
export async function registerPushWithBackend(
  subscription: PushSubscription,
  authToken?: string,
): Promise<boolean> {
  try {
    // Serialize the subscription as the token
    const token = JSON.stringify(subscription.toJSON());

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/notifications/devices/register`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          token,
          platform: 'web',
          deviceName: navigator.userAgent.substring(0, 255),
        }),
      },
    );

    if (!response.ok) {
      console.error('[WebPush] Backend registration failed:', response.status);
      return false;
    }

    console.log('[WebPush] Token registered with backend');
    return true;
  } catch (err) {
    console.error('[WebPush] Failed to register with backend:', err);
    return false;
  }
}

/**
 * Unregister the web push subscription from the backend.
 */
export async function unregisterPushFromBackend(
  subscription: PushSubscription,
  authToken?: string,
): Promise<boolean> {
  try {
    const token = JSON.stringify(subscription.toJSON());

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/notifications/devices/unregister`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
      },
    );

    return response.ok;
  } catch (err) {
    console.error('[WebPush] Failed to unregister from backend:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Foreground notification display with deep link support
// ---------------------------------------------------------------------------

/**
 * Show an in-page notification banner for foreground push notifications.
 * Uses the service worker's push event data to display a notification
 * and navigate the user on click.
 */
export function showForegroundNotification(
  title: string,
  body: string,
  deepLink?: DeepLinkData | null,
): void {
  if (typeof window === 'undefined') return;

  // Dispatch a custom event that the NotificationBanner component can listen to
  const event = new CustomEvent('lumenpulse-push-notification', {
    detail: { title, body, deepLink, timestamp: Date.now() },
  });
  window.dispatchEvent(event);

  // Also show a browser notification if the page is not visible
  if (document.visibilityState !== 'visible' && getNotificationPermission() === 'granted') {
    const notification = new Notification(title, {
      body,
      icon: '/assets/starkpulse-03.png',
      tag: deepLink ? `lumenpulse-${deepLink.screen}` : 'lumenpulse-general',
    });

    notification.onclick = () => {
      window.focus();
      if (deepLink) {
        navigateToDeepLinkWeb(deepLink);
      }
      notification.close();
    };
  }
}

/**
 * Navigate to a deep link screen on the web app.
 */
export function navigateToDeepLinkWeb(deepLink: DeepLinkData): void {
  let path = '/';

  switch (deepLink.screen) {
    case 'news_detail':
      path = deepLink.id ? `/news?id=${deepLink.id}` : '/news';
      break;
    case 'project_detail':
      path = deepLink.id ? `/dashboard?project=${deepLink.id}` : '/dashboard';
      break;
    case 'portfolio':
      path = '/dashboard';
      break;
    case 'transaction_detail':
      path = deepLink.id ? `/dashboard?tx=${deepLink.id}` : '/dashboard';
      break;
    case 'settings':
      path = '/dashboard?section=settings';
      break;
    case 'settings_notifications':
      path = '/dashboard?section=notifications';
      break;
    case 'notifications_list':
      path = '/dashboard?section=notifications';
      break;
    case 'asset_detail': {
      const code = deepLink.params?.code || deepLink.id;
      if (code) {
        const params = new URLSearchParams();
        params.set('code', String(code));
        if (deepLink.params?.issuer) {
          params.set('issuer', deepLink.params.issuer as string);
        }
        path = `/dashboard?${params.toString()}`;
      } else {
        path = '/dashboard';
      }
      break;
    }
    case 'discover':
      path = '/dashboard';
      break;
  }

  // Use Next.js router via window location
  window.location.href = path;
}

/**
 * Full push notification setup flow:
 * 1. Request permission
 * 2. Subscribe to push
 * 3. Register with backend
 *
 * Returns true if fully set up, false otherwise.
 */
export async function setupWebPushNotifications(
  authToken?: string,
): Promise<boolean> {
  if (!isPushSupported()) {
    console.warn('[WebPush] Push not supported in this browser');
    return false;
  }

  // Step 1: Request permission
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('[WebPush] Notification permission not granted');
    return false;
  }

  // Step 2: Subscribe via push manager
  const subscription = await subscribeToPush();
  if (!subscription) {
    console.error('[WebPush] Failed to create push subscription');
    return false;
  }

  // Step 3: Register with backend
  const registered = await registerPushWithBackend(subscription, authToken);
  if (!registered) {
    console.error('[WebPush] Failed to register with backend');
    return false;
  }

  return true;
}
