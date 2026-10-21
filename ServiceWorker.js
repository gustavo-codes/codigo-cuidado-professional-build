const cacheName = "UFC-Código Cuidado-0.1.3";
const contentToCache = [
    "Build/gat8profissional.loader.js",
    "Build/gat8profissional.framework.js.br",
    "Build/gat8profissional.data.br",
    "Build/gat8profissional.wasm.br",
    "TemplateData/style.css"

];

self.addEventListener('install', function (e) {
    console.log('[Service Worker] Install');
    
    e.waitUntil((async function () {
      const cache = await caches.open(cacheName);
      console.log('[Service Worker] Caching all: app shell and content');
      await cache.addAll(contentToCache);
    })());
});

// Remove caches de versões antigas ao ativar a nova versão do SW.
self.addEventListener('activate', function (e) {
    e.waitUntil((async function () {
        const nomes = await caches.keys();
        await Promise.all(nomes.filter(n => n !== cacheName).map(n => caches.delete(n)));
    })());
});

self.addEventListener('fetch', function (e) {
    e.respondWith((async function () {
      let response = await caches.match(e.request);
      console.log(`[Service Worker] Fetching resource: ${e.request.url}`);
      if (response) { return response; }

      response = await fetch(e.request);
      const cache = await caches.open(cacheName);
      console.log(`[Service Worker] Caching new resource: ${e.request.url}`);
      cache.put(e.request, response.clone());
      return response;
    })());
});
