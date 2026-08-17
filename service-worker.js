const CACHE_NAME    = 'guarani-tour-v93';
const CACHE_IMAGES  = 'guarani-tour-images-v1';
const CACHE_EXTERN  = 'guarani-tour-extern-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/usuarios.css',
  '/css/viajes_activos.css',
  '/css/pagos.css',
  '/css/resumen.css',
  '/css/recibos.css',
  '/css/movimientos.css',
  '/css/byc.css',
  '/css/dashboard.css',
  '/css/novedades.css',
  '/css/custom-select.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/supabaseClient.js',
  '/js/custom-select.js',
  '/js/push-notifications.js',
  '/js/viajes_activos.js',
  '/js/historial_pdf.js',
  '/js/viajes_egresos.js',
  '/js/viajes_presupuesto.js',
  '/js/usuarios.js',
  '/js/usuarios-reservas.js',
  '/js/pagos.js',
  '/js/extras.js',
  '/js/resumen.js',
  '/js/recibos.js',
  '/js/byc.js',
  '/js/dashboard.js',
  '/js/novedades.js',
  '/js/movimientos.js',
  '/firebase-config.js',
  '/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/apple-touch-icon.png',
  '/icons/guaranitour_192.png',
  '/icons/guaranitour_512.png',
  '/manifest.json',
];

// Instalar: cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos (respeta CACHE_IMAGES y CACHE_EXTERN)
self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, CACHE_IMAGES, CACHE_EXTERN];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Mensaje desde la app: limpiar entradas viejas de una imagen en CACHE_IMAGES
// (ignora el query string ?t=... para matchear todas las versiones del mismo path)
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_IMAGE_CACHE' && event.data?.pathContains) {
    const needle = event.data.pathContains;
    event.waitUntil(
      caches.open(CACHE_IMAGES).then(async cache => {
        const requests = await cache.keys();
        const toDelete = requests.filter(req => req.url.includes(needle));
        await Promise.all(toDelete.map(req => cache.delete(req)));
      })
    );
  }
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── Imágenes de Supabase Storage: cache-first, guarda en CACHE_IMAGES
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')) {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // ── API REST de Supabase: siempre red, sin cache
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // ── Google Fonts y CDN jsdelivr: cache-first, guarda en CACHE_EXTERN
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('www.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.open(CACHE_EXTERN).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // ── Todo lo demás (tus JS/CSS/HTML): cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
