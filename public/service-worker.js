const CACHE_NAME = 'agent-monitor-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/workspace',
  '/public/manifest.webmanifest',
  '/public/icons/icon.svg',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/apple-touch-icon-180.png',
  '/public/monitor.css?v=20260314-pwa1',
  '/public/workspace.css?v=20260314-pwa1',
  '/public/pwa.js?v=20260314-pwa1',
  '/public/monitor.js?v=20260314-pwa1',
  '/public/workspace.js?v=20260314-pwa1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHtmlShell = request.mode === 'navigate';
  const isStaticAsset = url.pathname.startsWith('/public/');

  if (isHtmlShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        });
      })
    );
  }
});
