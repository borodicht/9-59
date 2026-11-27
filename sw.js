// Service worker сайта «Мечта. 9:59».
// Даёт офлайн-доступ к странице и фрагменту книги.
// После изменения списка файлов или стратегии увеличьте VERSION.

const VERSION = "v4";
const SHELL_CACHE = `mechta-shell-${VERSION}`;
const RUNTIME_CACHE = `mechta-runtime-${VERSION}`;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./assets/content/fragment.json",
  "./assets/images/hero-room-v1.webp",
  "./assets/images/book-mockup.webp",
  "./assets/images/book-mockup-mask.png",
  "./assets/images/author-timofei-borodich-720.webp",
  "./assets/images/author-timofei-borodich-1080.webp",
  "./assets/images/favicon-32.png",
  "./assets/images/icon-192.png"
];

// Аудио и файлы книги не кэшируем: они большие, а аудио запрашивается диапазонами (Range).
const NO_CACHE_PREFIXES = ["/assets/audio/", "/assets/books/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = (await caches.match(request)) ??
      (request.mode === "navigate" ? await caches.match("./index.html") : undefined);

    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }

  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET" || request.headers.has("range")) {
    return;
  }

  const url = new URL(request.url);

  // Шрифты Google: неизменяемые файлы, можно брать из кэша.
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (NO_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  // Картинки меняются редко — показываем из кэша и тихо обновляем.
  if (request.destination === "image") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // HTML, CSS, JS, JSON — сначала сеть, чтобы после деплоя сразу была новая версия.
  event.respondWith(networkFirst(request));
});
