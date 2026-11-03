// Notificaciones de la app: contador de no leídas, revisión periódica de novedades
// (equivale al StatusSyncWorker de la app nativa anterior) y anuncios urgentes.
import {
  getNotificationsService, getAppRevisionService, getAnnouncementsService, confirmAnnouncementService
} from './api.js';
import { isAuthenticated, getUser } from './auth.js';
import { escapeHtml, openSheet, closeSheet, resolveMediaUrl, playFeedback } from './utils.js';
import { icon } from './icons.js';

const POLL_MS = 30000;
let unread = 0;
let lastRevision = null;
let timer = null;
let checking = false;

export function getUnreadCount() { return unread; }

function setUnread(n) {
  const next = Math.max(0, Number(n) || 0);
  const grew = next > unread;
  unread = next;
  document.querySelectorAll('[data-notif-badge]').forEach((el) => {
    el.textContent = unread > 99 ? '99+' : String(unread);
    el.hidden = unread === 0;
    if (grew) { el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump'); }
  });
  window.dispatchEvent(new CustomEvent('notif:count', { detail: { unread } }));
}

// Botón de campana para la barra de navegación (con su contador)
export function bellButtonHTML() {
  return `
    <a href="#notifications" class="nav-btn nav-btn--bell" aria-label="Notificaciones">
      ${icon('bell')}
      <span class="bell-badge" data-notif-badge ${unread ? '' : 'hidden'}>${unread > 99 ? '99+' : unread}</span>
    </a>`;
}

export async function refreshUnread() {
  if (!isAuthenticated()) return;
  const res = await getNotificationsService(1, 0);
  if (res && res.success && res.data) setUnread(res.data.no_leidas);
}

// Revisa si hubo cambios (consulta liviana); si los hay, actualiza el contador y avisa a la pantalla
async function checkChanges() {
  if (checking || !isAuthenticated() || document.hidden || !navigator.onLine) return;
  checking = true;
  try {
    const res = await getAppRevisionService();
    if (!res || !res.success || !res.data) return;
    const rev = String(res.data.revision ?? '');
    if (lastRevision !== null && rev !== lastRevision) {
      await refreshUnread();
      window.dispatchEvent(new CustomEvent('app:changed', { detail: { revision: rev } }));
      checkUrgentAnnouncement();
    }
    lastRevision = rev;
  } finally {
    checking = false;
  }
}

// ── Anuncios urgentes: se muestran una vez y el trabajador confirma que los leyó ──
const SEEN_KEY = 'asistencia_anuncio_urgente_visto';
let showingUrgent = false;

function seenIds() {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch (_) { return []; }
}

export async function checkUrgentAnnouncement() {
  if (showingUrgent || !isAuthenticated()) return;
  const res = await getAnnouncementsService();
  if (!res || !res.success || !res.data || !Array.isArray(res.data.anuncios)) return;
  const seen = seenIds();
  const urgent = res.data.anuncios.find((a) => a.es_urgente && !a.leido && !seen.includes(a.id));
  if (urgent) showUrgent(urgent);
}

function showUrgent(a) {
  const host = document.querySelector('#app-view .view:not(.view--leaving) .view__content') || document.body;
  const modal = document.createElement('div');
  modal.className = 'sheet-backdrop';
  modal.dataset.dismissible = 'false';
  modal.hidden = true;
  const img = a.imagen_url ? `<img class="urgent-notice__img" src="${escapeHtml(resolveMediaUrl(a.imagen_url))}" alt="${escapeHtml(a.titulo || 'Aviso')}" loading="lazy" data-zoom data-zoom-title="${escapeHtml(a.titulo || 'Aviso')}">` : '';
  modal.innerHTML = `
    <div class="sheet sheet--center urgent-notice" role="alertdialog" aria-labelledby="urgent-title">
      <div class="sheet__grabber"></div>
      <span class="urgent-notice__icon">${icon('megaphone')}</span>
      <span class="ios-badge badge-danger">Aviso urgente</span>
      <h3 id="urgent-title" class="result-title">${escapeHtml(a.titulo || 'Aviso')}</h3>
      ${img}
      <p class="result-message">${escapeHtml(a.mensaje || '')}</p>
      ${a.detalle ? `<p class="urgent-notice__detail">${escapeHtml(a.detalle)}</p>` : ''}
      <button type="button" class="ios-btn ios-btn-primary" data-confirm>Entendido</button>
    </div>`;
  host.appendChild(modal);
  showingUrgent = true;
  const done = async () => {
    const btn = modal.querySelector('[data-confirm]');
    btn.disabled = true;
    try {
      const seen = seenIds();
      seen.push(a.id);
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-50)));
    } catch (_) {}
    confirmAnnouncementService(a.id).catch(() => {});
    Promise.resolve(closeSheet(modal)).finally(() => { modal.remove(); showingUrgent = false; });
  };
  modal.querySelector('[data-confirm]').addEventListener('click', done);
  openSheet(modal, { focus: modal.querySelector('[data-confirm]') });
  playFeedback('warning');
}

export function initNotifications() {
  const start = () => {
    if (!isAuthenticated()) return;
    refreshUnread();
    checkChanges();
  };
  // Al iniciar sesión (cambia el usuario) se vuelve a empezar
  let lastUser = null;
  window.addEventListener('hashchange', () => {
    const id = (getUser() || {}).id || null;
    if (id !== lastUser) { lastUser = id; lastRevision = null; setUnread(0); start(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkChanges(); });
  window.addEventListener('online', () => checkChanges());
  // La notificación push que llega con la app abierta actualiza el contador al instante
  window.addEventListener('android:push', () => { refreshUnread(); window.dispatchEvent(new CustomEvent('app:changed')); });
  clearInterval(timer);
  timer = setInterval(checkChanges, POLL_MS);
  lastUser = (getUser() || {}).id || null;
  start();
}
