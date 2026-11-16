/* BSXS Manager — service worker.
   Zasady:
   - HTML: cache-first (ponowne otwarcie startuje natychmiast), świeża kopia
     dociąga się w tle. Nazwy plików są stałe, więc stary HTML jest bezpieczny.
   - JS i CSS: network-first z awaryjnym cache. To celowe — przy stałych nazwach
     plików mieszanie wersji z cache (nowy moduł + stary silnik) kończyło się
     błędem importu. Sieć daje spójny zestaw, cache ratuje offline.
   - Obrazy, manifest i pozostałe: cache-first z odświeżaniem w tle. */

const VERSION = 'bsxs-v5';
const CACHE = `${VERSION}-shell`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './css/app.css',
  './js/main.js',
  './js/core/errors.js',
  './js/core/util.js',
  './js/core/version.js',
  './js/core/log.js',
  './js/core/crypto.js',
  './js/core/validate.js',
  './js/core/store.js',
  './js/core/authz.js',
  './js/core/session.js',
  './js/core/backup.js',
  './js/core/diagnostics.js',
  './js/core/ui.js',
  './js/core/router.js',
  './js/ui/auth-screen.js',
  './js/ui/shell.js',
  './js/ui/page.js',
  './js/modules/registry.js',
  './js/modules/dashboard.js'
];

function offlineResponse() {
  return new Response('Zasób niedostępny offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let stored = 0;
    // Pojedynczy brakujący plik nie może zepsuć całej instalacji.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { credentials: 'same-origin' }));
        stored += 1;
      } catch (err) {
        // Offline / limit ruchu — pomijamy ten zasób.
      }
    }));
    // Gdy nie udało się zapisać ani jednego pliku (np. host zwraca 1027),
    // przerywamy instalację: poprzednia wersja service workera i jej cache
    // zostają, więc aplikacja dalej działa offline.
    if (stored === 0) {
      throw new Error('Nie udało się zapisać kopii offline — zachowuję poprzednią wersję.');
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

/** Natychmiast z cache, odświeżenie w tle — dla dużych, rzadkich zasobów. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await caches.match(request, { ignoreSearch: true });

  if (cached) {
    fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        return cache.put(request, response.clone());
      }
      return null;
    }).catch(() => {});
    return cached;
  }

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    return offlineResponse();
  }
}

/** Dokument: natychmiast z cache, świeża kopia w tle na następne uruchomienie. */
async function warmNavigation(request) {
  const cache = await caches.open(CACHE);
  const cached = await caches.match(request, { ignoreSearch: true })
    || await caches.match('./index.html');

  if (cached) {
    fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        return cache.put(request, response.clone());
      }
      return null;
    }).catch(() => {});
    return cached;
  }

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const fallback = await caches.match('./index.html');
    return fallback || offlineResponse();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Wszystko (nawigacja, JS, CSS) idzie z cache natychmiast, a świeża kopia
  // dociąga się w tle. To minimalizuje liczbę zapytań — preview ma limit
  // ruchu, a każde przeładowanie kilkudziesięciu plików go wyczerpywało.
  event.respondWith(request.mode === 'navigate'
    ? warmNavigation(request)
    : staleWhileRevalidate(request));
});
