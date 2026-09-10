// Caches only the app "shell" (static files) so the app can install and
// open instantly. It NEVER caches /api/* — data always comes fresh from
// MongoDB Atlas so you never see stale invoices/stock.
const CACHE_NAME = 'sawmill-erp-shell-v1';
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
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
