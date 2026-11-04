// Service Worker para PWA Asistencia Ideas
const CACHE_VERSION = 'ideas-4.2.1-navidad-r1';
const CACHE_STATIC = `asistencia-static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `asistencia-dynamic-${CACHE_VERSION}`;

// Tiempo máximo de espera a la red para un recurso que no está en caché. Con Wi-Fi
// conectado pero el servidor apagado, iOS puede esperar más de un minuto: mientras tanto
// la hoja de estilos bloquea el dibujo y la app se queda en pantalla negra.
const NETWORK_TIMEOUT_MS = 4000;

// Recursos principales que se guardan en la instalación.
const STATIC_ASSETS = [
  './js/staff-api.js',
  './js/contact-links.js',
  './js/personal-web-login.js',
  './pages/contacts.js',
  './js/staff-app.js',
  './css/staff-app.css?v=4.2.1',
  './js/student-push.js',
  './js/worker-contact.js',
  './js/student-web-login.js',
  "./js/app-runtime.js",
  "./js/entry.js",
  "./js/student-api.js",
  "./js/student-app.js",
  "./js/student-model.js",
  "./js/student-attendance.js",
  "./js/student-mark-queue.js",
  "./js/student-settings.js",
  "./js/student-biometric.js",
  "./js/student-server.js",
  "./js/server-context.js",
  "./js/biometric.js",
  "./js/theme.js",
  "./css/student-app.css?v=23",
  "./css/theme-motion.css?v=2",




  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=4.2.1',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/db.js',
  './js/security.js',
  './js/install.js',
  './js/sync.js',
  './js/scanner.js',
  './js/router.js',
  './js/utils.js',
  './js/sheet.js',
  './js/icons.js',
  './js/photo.js',
  './js/push.js',
  './js/notifications.js',
  './fonts/inter-latin-wght.woff2',
  './fonts/inter-latin-ext-wght.woff2',
  './js/jsQR.min.js',
  './js/qr-worker.js',
  './js/location.js',
  './js/viewer.js',
  './pages/login.js',
  './pages/home.js',
  './pages/scanner.js',
  './pages/history.js',
  './pages/requests.js',
  './pages/permissions.js',
  './pages/corrections.js',
  './pages/profile.js',
  './pages/notifications.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  // Recursos compartidos que index.html y el login cargan desde ../public
  '../public/ideas-season.css?v=29',
  '../public/ideas-season.js?v=29',
  '../public/img/ideas-official.png'
];

// Instala el Service Worker y precachea estáticos.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // cache: 'reload' evita que la versión nueva se arme con archivos viejos de la caché HTTP
      return cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
});

// Limpia cachés antiguas al activar una nueva versión.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Solo borra versiones anteriores de esta app (no las cachés del panel o de la pantalla QR)
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('asistencia-') && key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// fetch con límite de tiempo
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function isNavigation(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

// La app es una sola página: cualquier navegación se responde con index.html
async function appShell() {
  const cache = await caches.open(CACHE_STATIC);
  return (await cache.match('./index.html', { ignoreSearch: true }))
    || (await cache.match('./', { ignoreSearch: true }));
}

// Intercepta peticiones de red según su tipo.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar peticiones no HTTP/HTTPS o esquemas especiales.
  if (!url.protocol.startsWith('http')) return;

  // La API nunca pasa por la caché: contiene datos privados y la app ya guarda
  // lo necesario para trabajar sin conexión en IndexedDB.
  if (url.pathname.includes('/api/') || url.origin !== self.location.origin) return;

  // Solo se cachean peticiones GET
  if (event.request.method !== 'GET') return;

  const navigation = isNavigation(event.request);
  const scope = new URL('./', self.location.href);
  const appNavigation = navigation && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  const staticAsset = STATIC_ASSETS.some((path) => new URL(path, self.location.href).href === url.href);
  // No guardar documentos privados del panel ni destinos de navegación ajenos a esta app.
  const mediaAsset = /\/uploads\/.*\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname);
  if (!staticAsset && !appNavigation && !mediaAsset) return;

  // Recursos estáticos: Cache First con recuperación de red.
  event.respondWith((async () => {
    const staticCache = await caches.open(CACHE_STATIC);
    const dynamicCache = await caches.open(CACHE_DYNAMIC);
    let cachedRes = (await staticCache.match(event.request)) || (await dynamicCache.match(event.request));
    // Navegación con parámetros (?source=..., enlaces compartidos): sirve la app guardada
    if (!cachedRes && appNavigation) cachedRes = await appShell();

    if (cachedRes) {
      // Los módulos de una versión son inmutables hasta cerrar todas sus pantallas.
      // Sólo las imágenes dinámicas se renuevan mientras la app continúa abierta.
      if (mediaAsset) event.waitUntil(
        fetch(event.request).then((networkRes) => {
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            return caches.open(CACHE_DYNAMIC).then((cache) => cache.put(event.request, networkRes));
          }
        }).catch(() => {})
      );
      return cachedRes;
    }

    // Si no estaba en caché, buscar en red (con límite de tiempo) y cachear dinámicamente.
    try {
      const networkRes = await fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS);
      if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
        const clone = networkRes.clone();
        caches.open(CACHE_DYNAMIC).then((cache) => cache.put(event.request, clone)).catch(() => {});
      }
      return networkRes;
    } catch (_) {
      if (appNavigation) {
        const shell = await appShell();
        if (shell) return shell;
      }
      // Sin red ni copia: error inmediato (la página sigue, nada se queda esperando)
      return Response.error();
    }
  })());
});
