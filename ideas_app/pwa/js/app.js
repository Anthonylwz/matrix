// Punto de entrada principal de la PWA Asistencia Ideas
// Reintento de consultas de lectura tras un corte de red: se carga antes que todo lo demás.
import './net-retry.js';
import { $, setConnectionStatus, showToast, resolveMediaUrl } from './utils.js';
import { getUser } from './auth.js';
import { initRouter } from './router.js';
import { initDB } from './db.js';
import { checkServerStatus } from './api.js';
import { initSyncManager } from './sync.js';
import { initInstallManager } from './install.js';
import { initPush } from './push.js';
import { initNotifications } from './notifications.js';
import { initTheme } from './theme.js';
import { initImageViewer } from './viewer.js';

// Registra el Service Worker versionado
async function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.hostname !== 'appassets.androidplatform.net') {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      let announced = false;
      const announceUpdate = () => {
        if (announced || !navigator.serviceWorker.controller) return;
        announced = true;
        showToast('Hay una versión nueva. Cierra todas las pestañas de esta app y vuelve a abrirla para actualizar.', 'info', 12000);
      };
      // Puede haber terminado de instalar antes de abrir esta pantalla.
      if (reg.waiting) announceUpdate();
      // Escucha actualizaciones del Service Worker
      const watchInstalling = () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // No se recarga sola para no interrumpir una marcación en curso
              announceUpdate();
            }
          });
        }
      };
      reg.addEventListener('updatefound', watchInstalling);
      watchInstalling();
    } catch (err) {
      console.warn('Error al registrar Service Worker:', err);
    }
  }
}

// Administra el indicador visual de conectividad en el Header
function setupConnectivityMonitor() {
  async function updateStatus() {
    if (!navigator.onLine) {
      setConnectionStatus('offline', 'Sin conexión');
      return;
    }

    // Verificar disponibilidad real del servidor backend PHP
    try {
      const status = await checkServerStatus();
      // Interruptor global de decoraciones de temporada (Configuración del panel)
      if (status && status.raw && typeof status.raw.temporada === 'boolean') {
        try {
          const antes = localStorage.getItem('ideas-temporada-global');
          const ahora = status.raw.temporada ? 'on' : 'off';
          if (antes !== ahora) { localStorage.setItem('ideas-temporada-global', ahora); window.dispatchEvent(new Event('ideas:temporada')); }
        } catch (_) {}
      }
      if (status && status.success) {
        setConnectionStatus('online', 'En línea');
      } else {
        setConnectionStatus('offline', 'Sin servidor');
      }
    } catch (_) {
      setConnectionStatus('offline', 'Sin conexión');
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  // Una consulta falló por red: se muestra al momento y se vuelve a comprobar en 10 s
  let recheck = null;
  window.addEventListener('api:unreachable', () => {
    setConnectionStatus('offline', navigator.onLine ? 'Sin servidor' : 'Sin conexión');
    clearTimeout(recheck);
    recheck = setTimeout(updateStatus, 10000);
  });

  // Comprobación inicial y periódica cada 45 segundos
  updateStatus();
  setInterval(updateStatus, 45000);
}

// Pestaña Perfil: la foto del trabajador en lugar del ícono (si no tiene foto, queda el ícono)
function setupTabAvatar() {
  const tab = document.querySelector('#bottom-nav [data-route="profile"]');
  if (!tab) return;
  const svg = tab.querySelector('svg');
  const update = (srcOverride) => {
    const user = getUser();
    const src = srcOverride || (user && user.foto_url ? resolveMediaUrl(user.foto_url) : '');
    let img = tab.querySelector('.tab-avatar');
    if (!src) {
      if (img) img.remove();
      if (svg) svg.style.display = '';
      tab.classList.remove('has-avatar');
      return;
    }
    if (!img) {
      img = document.createElement('img');
      img.className = 'tab-avatar';
      img.alt = '';
      img.decoding = 'async';
      // Si la foto no carga (sin conexión la primera vez), vuelve el ícono
      img.addEventListener('error', () => { img.remove(); if (svg) svg.style.display = ''; tab.classList.remove('has-avatar'); });
      tab.insertBefore(img, svg);
    }
    if (img.getAttribute('src') !== src) img.src = src;
    if (svg) svg.style.display = 'none';
    tab.classList.add('has-avatar');
  };
  update();
  window.addEventListener('hashchange', () => update());
  window.addEventListener('user:photo', (e) => update(e.detail && e.detail.src));
}

// Muestra guía de instalación si el usuario abre en Safari en iPhone sin instalar
function setupIosInstallBanner() {
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  const banner = $('#ios-install-banner');
  const closeBtn = $('#btn-close-install');

  if (isIos && !isStandalone && banner) {
    // Si el usuario no ha descartado el banner previamente en esta sesión
    if (!sessionStorage.getItem('dismiss_install_banner')) {
      setTimeout(() => {
        banner.classList.add('visible');
      }, 2000);
    }
  }

  if (closeBtn && banner) {
    closeBtn.addEventListener('click', () => {
      banner.classList.remove('visible');
      sessionStorage.setItem('dismiss_install_banner', 'true');
    });
  }
}

// Inicialización de la aplicación
async function initApp() {
  // Inicializar base de datos local IndexedDB sin bloquear el primer dibujo:
  // si tarda o falla, cada consulta lo reintenta y la pantalla no se queda en negro.
  initDB().catch((err) => console.warn('IndexedDB no disponible:', err));

  // Pedir almacenamiento persistente: sin esto, Safari puede borrar las marcaciones
  // pendientes si la app no se abre en varios días.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  try { initTheme(); } catch (_) {}

  // Lo primero es dibujar la pantalla; lo demás es secundario y no debe impedirlo
  try {
    initRouter();
  } catch (err) {
    console.error('Error al iniciar el enrutador:', err);
    showFatalScreen();
  }

  const safe = (fn) => { try { fn(); } catch (err) { console.warn(err); } };
  safe(registerServiceWorker);
  safe(setupConnectivityMonitor);
  safe(initInstallManager);
  safe(setupIosInstallBanner);
  safe(initSyncManager);
  safe(initPush);
  safe(initNotifications);
  safe(initImageViewer);
  safe(setupTabAvatar);
}

// Último recurso: algo impidió dibujar la app. Mejor un aviso con "Reintentar" que una pantalla negra.
function showFatalScreen() {
  const stage = document.getElementById('app-view');
  if (!stage || stage.querySelector('.view')) return;
  stage.innerHTML = `
    <section class="view view--bare">
      <div class="view__scroll"><div class="view__content">
        <div class="page" style="padding:48px 24px;text-align:center">
          <h1 style="font-size:22px;margin-bottom:8px">No se pudo abrir la app</h1>
          <p style="opacity:.7;margin-bottom:24px">Revisa tu conexión e inténtalo de nuevo. Tus marcaciones guardadas no se pierden.</p>
          <button type="button" class="ios-btn ios-btn-primary" onclick="location.reload()">Reintentar</button>
        </div>
      </div></div>
    </section>`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
