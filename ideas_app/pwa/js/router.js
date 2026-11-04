// Enrutador SPA basado en hash con vistas estilo iOS:
// cada pantalla es una vista con su propia barra de navegación translúcida,
// Large Title que colapsa al desplazar y transiciones entre pantallas.
import { $, $$, escapeHtml, connectionPillHTML } from './utils.js';
import { isAuthenticated } from './auth.js';
import { closeAllSheets, dismissTopSheet } from './sheet.js';

// Módulos de páginas
import * as PageContacts from '../pages/contacts.js';
import * as PageLogin from '../pages/login.js';
import * as PageHome from '../pages/home.js';
import * as PageScanner from '../pages/scanner.js';
import * as PageHistory from '../pages/history.js';
import * as PageRequests from '../pages/requests.js';
import * as PageProfile from '../pages/profile.js';
import * as PageNotifications from '../pages/notifications.js';

// chrome: muestra barra de navegación; tab: pestaña que se marca activa;
// modal: se presenta a pantalla completa sobre la pestaña actual (sin tab bar).
const routes = {
  contacts: { module: PageContacts, title: 'Compañeros', modal: true },
  login: { module: PageLogin, chrome: false },
  home: { module: PageHome, title: 'Hoy', tab: 'home', large: true },
  history: { module: PageHistory, title: 'Historial', tab: 'history', large: true },
  requests: { module: PageRequests, title: 'Solicitudes', tab: 'requests', large: true },
  profile: { module: PageProfile, title: 'Perfil', tab: 'profile', large: true },
  // Centro de notificaciones: se presenta sobre la pestaña actual (botón Cerrar)
  notifications: { module: PageNotifications, title: 'Notificaciones', modal: true },
  // Inmersivo: la cámara ocupa toda la pantalla y la página dibuja sus controles flotantes
  scanner: { module: PageScanner, title: 'Marcar asistencia', modal: true, chrome: false, immersive: true }
};

// Rutas antiguas que ahora viven dentro de Solicitudes
const aliases = {
  permissions: '#requests?tab=permisos',
  corrections: '#requests?tab=correcciones'
};

const ICON_CLOSE_TEXT = 'Cerrar';
const EASE_SHEET = 'cubic-bezier(0.32, 0.72, 0, 1)';

let currentRoute = null;
let currentView = null;
let lastTabRoute = 'home';
let pending = []; // transiciones en curso: { el, anim, settle }

// Obtiene la ruta limpia a partir del hash
function getRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
  return hash || 'home';
}

// Parámetros opcionales después de la ruta (ej: #scanner?manual)
export function getRouteParams() {
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query);
}

// Cambia los parámetros de la ruta actual sin volver a renderizar
export function replaceRouteParams(params) {
  const query = new URLSearchParams(params).toString();
  const route = getRouteFromHash();
  history.replaceState(null, '', `#${route}${query ? `?${query}` : ''}`);
}

// Pestaña a la que vuelve un modal al cerrarse
export function getReturnRoute() {
  return lastTabRoute;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Termina de inmediato cualquier transición en curso (navegación interrumpida)
function finishPendingTransitions() {
  const list = pending;
  pending = [];
  list.forEach((p) => {
    try { p.anim.cancel(); } catch (_) {}
    p.settle();
  });
}

function animate(el, keyframes, options, settle) {
  if (typeof el.animate !== 'function') {
    settle();
    return;
  }
  const anim = el.animate(keyframes, { fill: 'none', ...options });
  const entry = { el, anim, settle };
  pending.push(entry);
  let done = false;
  entry.settle = () => {
    if (done) return;
    done = true;
    pending = pending.filter((p) => p !== entry);
    settle();
  };
  anim.onfinish = entry.settle;
  // Respaldo: si la página deja de pintarse (app en segundo plano) la vista no queda a medias
  setTimeout(entry.settle, (options.duration || 0) + 200);
}

// Construye la estructura de una vista
function buildView(route, cfg) {
  const view = document.createElement('section');
  view.className = 'view';
  view.dataset.route = route;
  if (cfg.modal) view.classList.add('view--modal');
  if (cfg.chrome === false) view.classList.add('view--bare');
  if (cfg.tab) view.classList.add('view--tab');
  if (cfg.immersive) view.classList.add('view--immersive');

  const mod = cfg.module;
  const title = escapeHtml(cfg.title || '');

  let navHTML = '';
  if (cfg.chrome !== false) {
    const leading = cfg.modal
      ? `<button type="button" class="nav-btn nav-btn--text" data-nav-close>${ICON_CLOSE_TEXT}</button>`
      : '';
    const actions = typeof mod.navActions === 'function' ? mod.navActions() : '';
    navHTML = `
      <header class="nav-bar${cfg.large ? '' : ' nav-bar--inline'}">
        <div class="nav-bar__leading">${leading}</div>
        <div class="nav-bar__title" aria-hidden="${cfg.large ? 'true' : 'false'}">${title}</div>
        <div class="nav-bar__trailing">${actions}${connectionPillHTML()}</div>
      </header>
    `;
  }

  let largeTitleHTML = '';
  if (cfg.large) {
    const kicker = typeof mod.kicker === 'function' ? mod.kicker() : '';
    const accessory = typeof mod.titleAccessory === 'function' ? mod.titleAccessory() : '';
    largeTitleHTML = `
      <div class="large-title">
        ${kicker ? `<div class="large-title__kicker">${escapeHtml(kicker)}</div>` : ''}
        <div class="large-title__row">
          <h1 class="large-title__text">${title}</h1>
          ${accessory ? `<div class="large-title__accessory">${accessory}</div>` : ''}
        </div>
      </div>
    `;
  }

  view.innerHTML = `
    ${navHTML}
    <div class="view__scroll">
      ${largeTitleHTML}
      <div class="view__content"></div>
    </div>
  `;
  return view;
}

// La barra pasa de transparente a material y muestra el título pequeño al desplazar
function bindScrollEdge(view, cfg) {
  const nav = view.querySelector('.nav-bar');
  const scroller = view.querySelector('.view__scroll');
  if (!nav || !scroller) return;
  const largeTitle = view.querySelector('.large-title__text');

  const update = () => {
    const y = scroller.scrollTop;
    nav.classList.toggle('is-scrolled', y > 2);
    if (cfg.large && largeTitle) {
      const collapsed = y > largeTitle.offsetTop + largeTitle.offsetHeight - nav.offsetHeight;
      nav.classList.toggle('is-collapsed', collapsed);
      nav.querySelector('.nav-bar__title').setAttribute('aria-hidden', collapsed ? 'false' : 'true');
    }
  };
  scroller.addEventListener('scroll', update, { passive: true });
  update();
}

// Carga la vista correspondiente
export async function navigateTo(route) {
  let targetRoute = route || getRouteFromHash();

  if (aliases[targetRoute]) {
    window.location.replace(aliases[targetRoute]);
    return;
  }

  // Protección de rutas: comprobar autenticación
  const authed = isAuthenticated();
  if (!authed && targetRoute !== 'login') {
    window.location.hash = '#login';
    return;
  }
  if (authed && targetRoute === 'login') {
    window.location.hash = '#home';
    return;
  }

  if (!routes[targetRoute]) targetRoute = 'home';
  const cfg = routes[targetRoute];
  const prevCfg = currentRoute ? routes[currentRoute] : null;
  const stage = $('#app-view');
  if (!stage) return;

  finishPendingTransitions();
  closeAllSheets();

  const oldView = currentView;
  const view = buildView(targetRoute, cfg);
  stage.appendChild(view);

  if (oldView) {
    // La vista saliente pierde sus IDs para que la nueva página no los confunda
    oldView.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    oldView.setAttribute('inert', '');
    oldView.setAttribute('aria-hidden', 'true');
    oldView.classList.add('view--leaving');
  }

  currentRoute = targetRoute;
  currentView = view;
  if (cfg.tab) lastTabRoute = targetRoute;
  setImmersive(Boolean(cfg.immersive));

  // Pestaña activa
  $$('.tab-item', $('#bottom-nav')).forEach((tab) => {
    const active = tab.getAttribute('data-route') === cfg.tab;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  moveTabIndicator();

  // Renderizar e inicializar página
  const content = view.querySelector('.view__content');
  try {
    cfg.module.render(content);
  } catch (err) {
    // Una pantalla con error no debe dejar la app en blanco
    console.error(`Error al dibujar ${targetRoute}:`, err);
    content.innerHTML = `
      <div class="page" style="padding:32px 16px;text-align:center">
        <p style="margin-bottom:16px">No se pudo mostrar esta pantalla.</p>
        <button type="button" class="ios-btn ios-btn-primary" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
  bindScrollEdge(view, cfg);

  // Botones Cerrar de los modales (de la barra o dibujados por la propia página)
  view.querySelectorAll('[data-nav-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.hash = `#${lastTabRoute}`;
    });
  });
  if (typeof cfg.module.init === 'function') {
    try {
      const ret = cfg.module.init();
      if (ret && typeof ret.catch === 'function') ret.catch((err) => console.error(`Error en ${targetRoute}:`, err));
    } catch (err) {
      console.error(`Error en ${targetRoute}:`, err);
    }
  }

  runTransition(prevCfg, cfg, oldView, view);
}

// Píldora que se desliza hasta la pestaña activa de la barra inferior
function moveTabIndicator() {
  const nav = $('#bottom-nav');
  if (!nav) return;
  let pill = nav.querySelector('.tab-indicator');
  const first = !pill;
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'tab-indicator';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
  }
  const place = () => {
    const active = nav.querySelector('.tab-item.active');
    if (!active || !active.offsetWidth) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  if (first) {
    pill.classList.add('no-anim');
    requestAnimationFrame(() => { place(); requestAnimationFrame(() => pill.classList.remove('no-anim')); });
    window.addEventListener('resize', place);
  } else {
    requestAnimationFrame(place);
  }
}

// Pantallas inmersivas (escáner): barras del sistema oscuras en Android y decoración en pausa
let immersiveOn = null;
function setImmersive(on) {
  if (immersiveOn === on) return;
  immersiveOn = on;
  document.body.classList.toggle('is-immersive', on);
  try {
    if (window.AndroidNet && typeof window.AndroidNet.setImmersive === 'function') window.AndroidNet.setImmersive(on);
  } catch (_) {}
  window.dispatchEvent(new Event('ideas:temporada'));
}

// Entrada escalonada del contenido (solo los primeros bloques, una vez por pantalla)
function staggerIn(view) {
  if (prefersReducedMotion()) return;
  view.classList.add('view--stagger');
  setTimeout(() => view.classList.remove('view--stagger'), 900);
}

function setTabBarHidden(hidden) {
  document.body.classList.toggle('no-bottom-nav', hidden);
}

function runTransition(prevCfg, cfg, oldView, newView) {
  const removeOld = () => { if (oldView) oldView.remove(); };
  const reduced = prefersReducedMotion();
  const showsTabBar = cfg.chrome !== false && !cfg.modal;

  // Misma pantalla con otros parámetros: reemplazo directo
  if (oldView && prevCfg === cfg) {
    removeOld();
    setTabBarHidden(!showsTabBar);
    return;
  }

  // Primera carga: solo la entrada escalonada del contenido
  if (!oldView || !prevCfg) {
    setTabBarHidden(!showsTabBar);
    staggerIn(newView);
    return;
  }

  if (reduced) {
    // Movimiento reducido: un fundido corto sustituye a los desplazamientos
    setTabBarHidden(!showsTabBar);
    animate(newView, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'linear' }, () => {});
    animate(oldView, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear' }, removeOld);
    return;
  }

  if (cfg.modal && !prevCfg.modal) {
    // Presentar: el modal sube desde abajo sobre la pestaña actual
    animate(newView, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
      { duration: 480, easing: EASE_SHEET },
      () => { setTabBarHidden(true); removeOld(); });
    return;
  }

  if (prevCfg.modal && !cfg.modal) {
    // Descartar: el modal baja por donde entró y deja ver la pestaña debajo
    setTabBarHidden(!showsTabBar);
      animate(oldView, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }],
      { duration: 400, easing: EASE_SHEET }, removeOld);
    return;
  }

  // Entre pestañas (o desde/hacia el login): un solo fundido breve. Sumarle la subida
  // escalonada hacía que la pantalla pareciera cargarse dos veces.
  setTabBarHidden(!showsTabBar);
  animate(newView, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }, () => {});
  animate(oldView, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear' }, removeOld);
}

// Inicia los observadores del Router
export function initRouter() {
  window.addEventListener('hashchange', () => {
    navigateTo(getRouteFromHash());
  });

  // Tocar la pestaña activa lleva al inicio de la pantalla (comportamiento iOS)
  const nav = $('#bottom-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab-item');
      if (!tab || !currentView) return;
      if (tab.getAttribute('data-route') === currentRoute) {
        e.preventDefault();
        const scroller = currentView.querySelector('.view__scroll');
        if (scroller) scroller.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    });
  }

  // Botón Atrás de Android: hoja abierta → se cierra; escáner → vuelve a su pestaña;
  // otra pestaña → Hoy; en Hoy o en el login la app solo se minimiza ('exit').
  window.__androidBack = () => {
    if (dismissTopSheet()) return 'handled';
    const cfg = currentRoute ? routes[currentRoute] : null;
    if (!cfg || currentRoute === 'login' || currentRoute === 'home') return 'exit';
    window.location.hash = cfg.modal ? `#${lastTabRoute}` : '#home';
    return 'handled';
  };

  // Foto de la galería que llegó cuando Android había cerrado la app: se continúa en Perfil
  window.addEventListener('android:photo', () => {
    if (currentRoute !== 'profile' && isAuthenticated()) window.location.hash = '#profile';
  });

  try {
    if (window.AndroidNet && typeof window.AndroidNet.hasPendingPhoto === 'function'
      && window.AndroidNet.hasPendingPhoto() && isAuthenticated()) {
      history.replaceState(null, '', '#profile');
    }
  } catch (_) {}

  // Carga la ruta inicial
  navigateTo(getRouteFromHash());
}
