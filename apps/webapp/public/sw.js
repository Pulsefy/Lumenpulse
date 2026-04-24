const CACHE_NAME = 'lumenpulse-v1';
const urlsToCache = [
  '/',
  '/news',
  '/dashboard',
  '/community',
  '/assets/starkpulse-03.png',
  '/assets/starkpulse-04.svg',
  '/assets/globe-texture.jpg',
  '/manifest.json'
];

// ---------------------------------------------------------------------------
// Deep link path resolver
// Maps deep link screen names to web app routes
// ---------------------------------------------------------------------------
function resolveDeepLinkPath(deepLink) {
  if (!deepLink || !deepLink.screen) return null;

  switch (deepLink.screen) {
    case 'news_detail':
      return deepLink.id ? `/news?id=${deepLink.id}` : '/news';
    case 'project_detail':
      return deepLink.id ? `/dashboard?project=${deepLink.id}` : '/dashboard';
    case 'portfolio':
      return '/dashboard';
    case 'transaction_detail':
      return deepLink.id ? `/dashboard?tx=${deepLink.id}` : '/dashboard';
    case 'settings':
      return '/dashboard?section=settings';
    case 'settings_notifications':
      return '/dashboard?section=notifications';
    case 'notifications_list':
      return '/dashboard?section=notifications';
    case 'asset_detail': {
      const code = deepLink.params?.code || deepLink.id;
      if (code) {
        const params = new URLSearchParams();
        params.set('code', code);
        if (deepLink.params?.issuer) params.set('issuer', deepLink.params.issuer);
        return `/dashboard?${params.toString()}`;
      }
      return '/dashboard';
    }
    case 'discover':
      return '/dashboard';
    default:
      return null;
  }
}

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle background sync tasks
      console.log('Background sync triggered')
    );
  }
});

// ---------------------------------------------------------------------------
// Push notifications with deep link support
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : 'New crypto news available!' };
  }

  const title = payload.title || 'LumenPulse';
  const body = payload.body || 'New update available!';
  const deepLink = payload.deepLink || payload.data?.deepLink || null;
  const eventType = payload.eventType || payload.data?.eventType || null;

  // Build action buttons based on deep link availability
  const actions = [];
  if (deepLink) {
    actions.push({
      action: 'open_deep_link',
      title: 'View Details',
      icon: '/assets/starkpulse-03.png'
    });
  }
  actions.push({
    action: 'close',
    title: 'Dismiss'
  });

  const options = {
    body,
    icon: '/assets/starkpulse-03.png',
    badge: '/assets/starkpulse-03.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      deepLink,
      eventType,
      primaryKey: Date.now()
    },
    actions,
    tag: deepLink ? `lumenpulse-${deepLink.screen}-${deepLink.id || ''}` : 'lumenpulse-general',
    renotify: true,
    requireInteraction: deepLink?.screen === 'security_alert' || eventType === 'security_alert'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ---------------------------------------------------------------------------
// Notification click handling with deep link routing
// Handles: direct click, action button click, and no deep link fallback
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const deepLink = notificationData.deepLink;
  let targetUrl = '/';

  // Determine target URL based on click action
  if (event.action === 'close') {
    return; // User dismissed
  }

  // Resolve deep link to a web route
  if (deepLink) {
    const resolved = resolveDeepLinkPath(deepLink);
    if (resolved) {
      targetUrl = resolved;
    }
  } else if (event.action === 'explore' || !event.action) {
    targetUrl = '/news';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there's already an open window, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});