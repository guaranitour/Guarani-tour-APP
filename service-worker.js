const CACHE_NAME    = 'guarani-tour-v22';
const CACHE_IMAGES  = 'guarani-tour-images-v1';
const CACHE_EXTERN  = 'guarani-tour-extern-v1';

const STATIC_ASSETS = [
  '/Guarani-tour-APP/',
  '/Guarani-tour-APP/index.html',
  '/Guarani-tour-APP/style.css',
  '/Guarani-tour-APP/usuarios.css',
  '/Guarani-tour-APP/viajes_activos.css',
  '/Guarani-tour-APP/pagos.css',
  '/Guarani-tour-APP/resumen.css',
  '/Guarani-tour-APP/recibos.css',
  '/Guarani-tour-APP/movimientos.css',
  '/Guarani-tour-APP/app.js',
  '/Guarani-tour-APP/auth.js',
  '/Guarani-tour-APP/supabaseClient.js',
  '/Guarani-tour-APP/viajes_activos.js',
  '/Guarani-tour-APP/usuarios.js',
  '/Guarani-tour-APP/pagos.js',
  '/Guarani-tour-APP/resumen.js',
  '/Guarani-tour-APP/recibos.js',
  '/Guarani-tour-APP/movimientos.js',
  '/Guarani-tour-APP/app_imagen_512px.png',
  '/Guarani-tour-APP/manifest.json',
];

// Instalar: cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
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
