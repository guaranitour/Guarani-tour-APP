const CACHE_NAME = 'guarani-tour-v1';

const STATIC_ASSETS = [
  '/Guarani-tour-APP/',
  '/Guarani-tour-APP/index.html',
  '/Guarani-tour-APP/style.css',
  '/Guarani-tour-APP/usuarios.css',
  '/Guarani-tour-APP/viajes_activos.css',
  '/Guarani-tour-APP/pagos.css',
  '/Guarani-tour-APP/app.js',
  '/Guarani-tour-APP/auth.js',
  '/Guarani-tour-APP/supabaseClient.js',
  '/Guarani-tour-APP/viajes_activos.js',
  '/Guarani-tour-APP/usuarios.js',
  '/Guarani-tour-APP/pagos.js',
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

// Activar: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para assets, network-first para Supabase
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase y Google APIs siempre desde la red
  if (url.hostname.includes('supabase.co') || url.hostname.includes('google')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Assets estáticos: cache first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
