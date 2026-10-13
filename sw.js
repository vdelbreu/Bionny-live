// Réseau d'abord (toujours la dernière version), cache en secours pour ouvrir l'app hors connexion.
const CACHE = 'viawrist-v8';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache : revalide auprès du serveur à chaque fois, sinon le cache HTTP (10 min sur GitHub Pages) sert une ancienne version
    fetch(req, { cache: 'no-cache' })
      .then(rep => {
        if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(req, copie)); }
        return rep;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true }))
        ?? (req.mode === 'navigate' ? await caches.match(new URL('./', location.href).href) : undefined)
        ?? Response.error())
  );
});
