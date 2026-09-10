// Caches the app "shell" (static files) so the app can install and open
// instantly, and still works offline. It NEVER caches /api/* — data
// always comes fresh from MongoDB Atlas so you never see stale
// invoices/stock.
//
// The HTML shell (/ and /index.html) is fetched network-first, so a
// new deploy shows up the next time you reload — even on a device
// that already has the app installed/cached — instead of waiting for
// this file's own bytes to change. Large, rarely-changing libraries
// are served cache-first (refreshed quietly in the background) for
// speed and offline use.
const CACHE_NAME = 'sawmill-erp-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/xlsx.full.min.js',
  '/qrcode.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // always network, never cached

  const isShellHtml = event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

  if (isShellHtml) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request)) // offline fallback only
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
