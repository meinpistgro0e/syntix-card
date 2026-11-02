// Syntix Card – Offline-Speicher. Bei Änderungen VERSION hochzählen.
const VERSION = 'syntix-card-2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'qr.js', 'manifest.webmanifest', 'assets/logo.svg', 'assets/icon-180.png', 'assets/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
// Erst Netz (damit Updates sofort ankommen), ohne Internet aus dem Speicher
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
