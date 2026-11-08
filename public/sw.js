// Jarvis service worker: shows push notifications (even when Jarvis isn't open) and opens Jarvis
// when you tap one. It doesn't cache anything, so the app is always the latest deploy.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    note = { title: 'Jarvis', body: event.data ? event.data.text() : '' };
  }
  const title = note.title || 'Jarvis';
  const priority = Number(note.priority) || 3;
  event.waitUntil(
    (async () => {
      // Tell any open Jarvis windows (they can show it in the HUD and speak it)
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: 'jarvis-notification', note });
      await self.registration.showNotification(title, {
        body: note.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: note.tag || undefined,
        renotify: Boolean(note.tag),
        requireInteraction: priority >= 5,
        silent: priority <= 1,
        vibrate: priority >= 4 ? [200, 100, 200] : undefined,
        timestamp: note.at ? Date.parse(note.at) : Date.now(),
        data: { url: note.url || '/' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Links into Jarvis focus an open Jarvis window; other links open normally
      if (target.origin === self.location.origin) {
        const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
        if (existing) {
          await existing.focus();
          if (target.pathname !== '/' || target.search) await existing.navigate(target.href).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// The browser rotated this device's push subscription: re-register it (needs the HUD's login cookie)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const options = old && old.options ? old.options : null;
      if (!options || !options.applicationServerKey) return;
      const sub = await self.registration.pushManager.subscribe(options);
      await fetch('/api/push', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON(), name: 'Device (renewed)' }),
      }).catch(() => {});
    })()
  );
});
