// Guarda la app para que abra sin conexión. Los mapas de fondo (Esri/OSM) NO se guardan: dependen de internet.
const CACHE = 'heladerias-v1';
const BASE = ['./', 'index.html', 'app.css', 'app.js', 'datos.js', 'manifest.webmanifest', 'icono-180.png', 'icono-192.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (para recibir datos nuevos) y, si no hay red, la copia guardada.
self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;
  ev.respondWith(
    fetch(ev.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(ev.request, copia)); }
      return r;
    }).catch(() => caches.match(ev.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
