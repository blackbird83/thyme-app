/* thyme – Service Worker für die Offline-Fähigkeit
 *
 * Grundsätze
 * - Die App-Seite (index.html) kommt immer zuerst aus dem Netz, damit Updates sofort
 *   ankommen. Ist das Netz weg oder zu langsam (> 3 s), kommt die gespeicherte Fassung.
 * - Schriften, Bibliotheken und Icons kommen aus dem Speicher (schnell, offline).
 * - Rezeptfotos aus Supabase werden beim Ansehen gespeichert und offline angezeigt.
 * - Datenbank, Anmeldung und Claude-Proxy laufen NIE über den Speicher –
 *   die App hat dafür ihre eigene Offline-Logik (lokale Rezepte, Nachholen beim Sync).
 *
 * Bei Änderungen an dieser Datei VERSION erhöhen: alte Speicher werden dann gelöscht.
 */
const VERSION = 'thyme-20261025b';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';
const PHOTO_CACHE = 'thyme-photos';          // bleibt über Versionen hinweg erhalten
const PHOTO_LIMIT = 300;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
  './icons/favicon-32.png'
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const runtime = await caches.open(RUNTIME_CACHE);
    // Bibliotheken einzeln laden: ein Ausfall darf die Installation nicht verhindern
    await Promise.all(LIBS.map((url) => runtime.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== PHOTO_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSupabaseApi(url) {
  return url.hostname.endsWith('.supabase.co') && !url.pathname.startsWith('/storage/v1/object/public/');
}
function isPhoto(url) {
  return url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/');
}
function isProxy(url) {
  return url.hostname.endsWith('.workers.dev');
}
function isStaticHost(url) {
  return ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'].includes(url.hostname);
}

// Seite: Netz zuerst (max. 3 s), sonst gespeicherte Fassung
async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    if (response && response.ok) cache.put('./index.html', response.clone());
    return response;
  } catch (e) {
    return (await cache.match('./index.html')) || (await cache.match('./')) ||
      new Response('<h1>thyme ist offline</h1><p>Bitte einmal mit Internet öffnen.</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Speicher zuerst, im Hintergrund aktualisieren
async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await caches.match(request);          // in allen Speichern suchen (auch App-Hülle)
  const fetching = fetch(request).then(async (response) => {
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return response;
  }).catch(() => null);
  return cached || (await fetching) || Response.error();
}

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // Speichern, Löschen usw. nie abfangen
  const url = new URL(request.url);
  if (isSupabaseApi(url) || isProxy(url)) return;       // Daten, Anmeldung, Realtime, Claude: immer direkt

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (isPhoto(url)) {
    event.respondWith(staleWhileRevalidate(request, PHOTO_CACHE, PHOTO_LIMIT));
    return;
  }
  if (url.origin === self.location.origin || isStaticHost(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
