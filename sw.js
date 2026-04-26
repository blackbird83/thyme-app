// thyme Service Worker — v1
const CACHE = 'thyme-v1';
const ASSETS = [
  '/thyme/',
  '/thyme/index.html',
  '/thyme/apple-touch-icon.png',
  '/thyme/manifest.json'
];

// Installation: Assets cachen
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Aktivierung: alten Cache löschen
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first Strategie
// Versucht zuerst das Netzwerk, fällt auf Cache zurück
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Erfolgreiche Antwort im Cache speichern
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Update-Mechanismus: bei neuer Version Clients benachrichtigen
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
