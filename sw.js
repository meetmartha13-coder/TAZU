/* TAZU service worker placeholder. Intentionally does not cache files yet,
   so users receive current app code while the prototype is being tested. */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
