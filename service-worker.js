const CACHE_NAME    = 'guarani-tour-v104';
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
  '/css/calendario.css',
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
  '/js/calendario.js',
  '/firebase-config.js',
  '/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/apple-touch-icon.png',
  '/icons/guaranitour_192.png',
  '/icons/guaranitour_512.png',
  '/img/cliente.png',
  '/img/viajes.png',
  '/img/recibo.png',
  '/img/bancario.png',
  '/img/byc.png',
  '/img/historial.png',
  '/img/asiento.png',
  '/img/staff.png',
  '/img/calendario.png',
  '/manifest.json',
];

// Instalar: cachear assets estáticos.
// Usamos Promise.allSettled en vez de cache.addAll() directo: addAll()
// es todo-o-nada — si UN solo asset de STATIC_ASSETS devuelve 404, la
// instalación entera falla y no se cachea nada, ni lo que sí existe.
// Con allSettled, un asset faltante solo se loguea y el resto se cachea
// igual.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url))
      );
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn('[SW] No se pudo precachear:', STATIC_ASSETS[i], r.reason);
        }
      });
      return self.skipWaiting();
    })
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

  // ── Íconos de módulos (/img/): cache-first, se guardan en CACHE_NAME
  // si por algún motivo no llegaron a precachearse en install (ej. un
  // módulo nuevo agregado sin actualizar STATIC_ASSETS).
  if (url.origin === self.location.origin && url.pathname.startsWith('/img/')) {
    event.respondWith(
      caches.match(event.request).then(async cached => {
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
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
