// Service Worker for Push Notifications
// This runs in the background and handles incoming push messages

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'default', // Collapse similar notifications
    data: {
      url: data.url || '/', // Where to navigate when clicked
    },
    vibrate: [100, 50, 100], // Vibration pattern
    requireInteraction: false, // Auto-dismiss after a while
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Cinechrony', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there's already a window/tab open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Service worker install event
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Service worker activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
