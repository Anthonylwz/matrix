// Centro de notificaciones: avisos del sistema (permisos, correcciones, asistencia) y anuncios.
// Reemplaza la pantalla NotificationCenterScreen de la app nativa anterior.
import { $, escapeHtml, showToast, showActionSheet, resolveMediaUrl, formatDayLabel, ICON_CHEVRON, hapticFeedback } from '../js/utils.js';
import { getUser } from '../js/auth.js';
import { icon, rowIcon } from '../js/icons.js';
import {
  getNotificationsService, markNotificationReadService, markAllNotificationsReadService,
  deleteNotificationService, deleteAllNotificationsService, getAnnouncementsService, confirmAnnouncementService
} from '../js/api.js';
import { refreshUnread } from '../js/notifications.js';

export function navActions() {
  return `
    <button type="button" id="btn-notif-more" class="nav-btn" aria-label="Más opciones">
      ${icon('dots')}
    </button>`;
}

export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div id="notif-announcements"></div>
      <div class="list-header row-between">
        <span>Avisos</span>
        <span id="notif-count" class="ios-badge badge-neutral">Cargando…</span>
      </div>
      <div id="notif-list">${skeleton()}</div>
    </div>`;
}

function skeleton(n = 4) {
  return `<div class="ios-card ios-card--flush">${Array.from({ length: n }, () => `
    <div class="skeleton-row"><span class="skeleton skeleton--block"></span>
      <span class="list-row__main"><span class="skeleton skeleton--line skeleton--w60"></span></span></div>`).join('')}</div>`;
}

// Ícono y color según el módulo del aviso
function kind(n) {
  const m = String(n.modulo || n.tipo || '').toLowerCase();
  if (m.includes('permis')) return { icon: 'doc', color: 'orange', route: '#requests?tab=permisos' };
  if (m.includes('correc')) return { icon: 'edit', color: 'blue', route: '#requests?tab=correcciones' };
  if (m.includes('asist') || m.includes('jornada') || m.includes('incid')) return { icon: 'clock', color: 'green', route: '#history' };
  if (m.includes('anunc') || m.includes('comunic') || m.includes('aviso')) return { icon: 'megaphone', color: 'purple', route: null };
  return { icon: 'bell', color: 'gray', route: null };
}

function when(fecha) {
  if (!fecha) return '';
  const day = String(fecha).slice(0, 10);
  const hora = String(fecha).slice(11, 16);
  return `${formatDayLabel(day)}${hora ? ` · ${hora}` : ''}`;
}

export function init() {
  const list = $('#notif-list');
  const countEl = $('#notif-count');
  const annBox = $('#notif-announcements');
  let items = [];
  let left = false;
  window.addEventListener('hashchange', () => { left = true; window.removeEventListener('app:changed', reload); }, { once: true });

  function paintCount() {
    const unread = items.filter((n) => !n.leida).length;
    if (countEl) countEl.textContent = unread ? `${unread} sin leer` : `${items.length} aviso${items.length === 1 ? '' : 's'}`;
    if (countEl) countEl.className = `ios-badge ${unread ? 'badge-warning' : 'badge-neutral'}`;
  }

  function renderList() {
    if (!list) return;
    paintCount();
    if (!items.length) {
      list.innerHTML = `
        <div class="empty-state">
          ${icon('bell')}
          <div class="empty-state__title">Sin avisos</div>
          <p class="empty-state__text">Aquí verás las respuestas a tus permisos y correcciones, y los avisos de la institución.</p>
        </div>`;
      return;
    }
    list.innerHTML = `<div class="ios-card ios-card--flush list-group--icons">${items.map((n) => {
      const k = kind(n);
      return `
        <div class="notif-row${n.leida ? '' : ' is-unread'}" data-id="${n.id}">
          <button type="button" class="list-row notif-row__main" data-open="${n.id}">
            ${rowIcon(k.icon, k.color)}
            <span class="list-row__main">
              <span class="notif-row__title">${escapeHtml(n.titulo || 'Aviso')}</span>
              <span class="list-row__sub">${escapeHtml(n.mensaje || '')}</span>
              <span class="notif-row__time">${escapeHtml(when(n.fecha))}</span>
            </span>
            ${n.leida ? '' : '<span class="notif-dot" aria-label="Sin leer"></span>'}
          </button>
          <button type="button" class="icon-btn notif-row__delete" data-delete="${n.id}" aria-label="Eliminar aviso">${icon('trash')}</button>
        </div>`;
    }).join('')}</div>`;
  }

  function renderOffline() {
    if (countEl) { countEl.textContent = 'Sin conexión'; countEl.className = 'ios-badge badge-neutral'; }
    if (list) list.innerHTML = `
      <div class="empty-state">
        ${icon('offline')}
        <div class="empty-state__title">No se pudo cargar</div>
        <p class="empty-state__text">Revisa tu conexión. Los avisos aparecerán cuando vuelvas a estar en línea.</p>
      </div>`;
  }

  // ── Comunicados: fijar y ocultar los leídos después de 3 días ──
  const READ_VISIBLE_DAYS = 3;
  const PRIORIDAD = { urgente: 0, importante: 1, normal: 2 };
  let anuncios = [];
  let showHidden = false;
  const pinKey = () => `asistencia_anuncios_fijados_${(getUser() || {}).id || 0}`;
  const readKey = () => `asistencia_anuncios_leidos_${(getUser() || {}).id || 0}`;
  const loadSet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) { return {}; } };
  const saveSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  let pins = loadSet(pinKey());

  const readAt = (a) => {
    // Fecha de lectura del servidor; si se marcó en este celular, la local
    const local = loadSet(readKey())[a.id];
    const t = a.fecha_lectura ? Date.parse(String(a.fecha_lectura).replace(' ', 'T')) : NaN;
    return Number.isFinite(t) ? t : (local || null);
  };
  const isHidden = (a) => {
    if (pins[a.id] || !a.leido) return false; // fijado o sin leer: siempre visible
    const t = readAt(a);
    return Boolean(t && Date.now() - t > READ_VISIBLE_DAYS * 86400000);
  };

  function renderAnnouncements() {
    if (!annBox) return;
    if (!anuncios.length) { annBox.innerHTML = ''; return; }
    const ordenados = [...anuncios].sort((x, y) =>
      (pins[y.id] ? 1 : 0) - (pins[x.id] ? 1 : 0)
      || (x.leido ? 1 : 0) - (y.leido ? 1 : 0)
      || (PRIORIDAD[x.prioridad] ?? 2) - (PRIORIDAD[y.prioridad] ?? 2)
      || String(y.created_at).localeCompare(String(x.created_at)));
    const visibles = ordenados.filter((a) => showHidden || !isHidden(a));
    const ocultos = ordenados.filter(isHidden).length;
    annBox.innerHTML = `
      <div class="list-header">Anuncios</div>
      <div class="announce-list">${visibles.map((a) => {
        const fijado = Boolean(pins[a.id]);
        const dias = a.leido && !fijado ? Math.max(0, READ_VISIBLE_DAYS - Math.floor((Date.now() - (readAt(a) || Date.now())) / 86400000)) : null;
        return `
        <article class="announce-card${a.es_urgente ? ' is-urgent' : ''}${a.leido ? '' : ' is-unread'}${fijado ? ' is-pinned' : ''}" data-anuncio="${a.id}">
          ${a.imagen_url ? `<img class="announce-card__img" src="${escapeHtml(resolveMediaUrl(a.imagen_url))}" alt="${escapeHtml(a.titulo || 'Comunicado')}" loading="lazy" data-zoom data-zoom-title="${escapeHtml(a.titulo || 'Comunicado')}">` : ''}
          <div class="announce-card__body">
            <div class="announce-card__top">
              <span class="announce-card__badges">
                ${fijado ? `<span class="ios-badge badge-neutral announce-pin-badge">${icon('pin')}Fijado</span>` : ''}
                ${a.es_urgente ? '<span class="ios-badge badge-danger">Urgente</span>' : (a.prioridad === 'importante' ? '<span class="ios-badge badge-warning">Importante</span>' : '')}
              </span>
              <button type="button" class="icon-btn announce-pin${fijado ? ' is-on' : ''}" data-pin="${a.id}" aria-pressed="${fijado}" aria-label="${fijado ? 'Quitar de fijados' : 'Fijar comunicado'}">${icon('pin')}</button>
            </div>
            <span class="notif-row__time">${escapeHtml(when(a.created_at))}</span>
            <h3 class="announce-card__title">${escapeHtml(a.titulo || '')}</h3>
            <p class="announce-card__text">${escapeHtml(a.mensaje || '')}</p>
            ${a.detalle ? `<p class="announce-card__detail">${escapeHtml(a.detalle)}</p>` : ''}
            ${a.leido
              ? `<span class="announce-card__read">${icon('check')} Leído${dias !== null ? ` · se oculta en ${dias === 0 ? 'menos de un día' : `${dias} día${dias === 1 ? '' : 's'}`}` : ''}</span>`
              : `<button type="button" class="ios-btn ios-btn-secondary announce-card__btn" data-ack="${a.id}">Marcar como leído</button>`}
          </div>
        </article>`;
      }).join('')}</div>
      ${ocultos ? `<button type="button" class="text-btn announce-hidden-toggle" data-toggle-hidden>${showHidden ? 'Ocultar comunicados leídos antiguos' : `Ver ${ocultos} comunicado${ocultos === 1 ? '' : 's'} leído${ocultos === 1 ? '' : 's'} anterior${ocultos === 1 ? '' : 'es'}`}</button>` : ''}`;
  }

  async function loadAnnouncements() {
    if (!annBox) return;
    const res = await getAnnouncementsService();
    if (left) return;
    if (!res || !res.success || !res.data || !Array.isArray(res.data.anuncios)) { if (!anuncios.length) annBox.innerHTML = ''; return; }
    anuncios = res.data.anuncios;
    renderAnnouncements();
  }

  async function load() {
    const res = await getNotificationsService(50, 0);
    if (left) return;
    if (res && res.success && res.data && Array.isArray(res.data.notificaciones)) {
      items = res.data.notificaciones;
      renderList();
    } else if (!items.length) {
      renderOffline();
    }
  }

  function reload() { load(); loadAnnouncements(); }
  window.addEventListener('app:changed', reload);

  // Tocar un aviso: se marca leído y se abre la pantalla relacionada
  list?.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      const id = Number(del.dataset.delete);
      const row = del.closest('.notif-row');
      row?.classList.add('is-removing');
      const res = await deleteNotificationService(id);
      if (res && res.success) {
        setTimeout(() => { items = items.filter((n) => n.id !== id); renderList(); refreshUnread(); }, 220);
      } else {
        row?.classList.remove('is-removing');
        showToast(res?.message || 'No se pudo eliminar el aviso', 'danger');
      }
      return;
    }
    const open = e.target.closest('[data-open]');
    if (!open) return;
    const n = items.find((x) => x.id === Number(open.dataset.open));
    if (!n) return;
    if (!n.leida) {
      n.leida = true;
      renderList();
      markNotificationReadService(n.id).then(() => refreshUnread());
    }
    const k = kind(n);
    if (k.route) window.location.hash = k.route;
  });

  annBox?.addEventListener('click', async (e) => {
    // Fijar / quitar de fijados
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const id = pin.dataset.pin;
      if (pins[id]) delete pins[id]; else pins[id] = Date.now();
      saveSet(pinKey(), pins);
      hapticFeedback([8]);
      showToast(pins[id] ? 'Comunicado fijado: queda arriba y no se oculta' : 'Comunicado quitado de fijados', 'success');
      renderAnnouncements();
      return;
    }
    if (e.target.closest('[data-toggle-hidden]')) {
      showHidden = !showHidden;
      renderAnnouncements();
      return;
    }
    const btn = e.target.closest('[data-ack]');
    if (!btn) return;
    btn.disabled = true;
    const id = Number(btn.dataset.ack);
    const res = await confirmAnnouncementService(id);
    if (res && res.success) {
      const a = anuncios.find((x) => Number(x.id) === id);
      if (a) {
        a.leido = true;
        a.fecha_lectura = (res.data && res.data.fecha_lectura) || null;
        const leidos = loadSet(readKey());
        leidos[id] = Date.now();
        saveSet(readKey(), leidos);
      }
      showToast(`Leído. Se ocultará en ${READ_VISIBLE_DAYS} días (fíjalo si quieres conservarlo)`, 'success');
      renderAnnouncements();
    } else {
      btn.disabled = false;
      showToast(res?.message || 'No se pudo confirmar el anuncio', 'danger');
    }
  });

  $('#btn-notif-more')?.addEventListener('click', async () => {
    const choice = await showActionSheet({
      title: 'Avisos',
      actions: [
        { label: 'Marcar todo como leído', value: 'read' },
        { label: 'Eliminar todos los avisos', value: 'delete', style: 'destructive' }
      ]
    });
    if (choice === 'read') {
      const res = await markAllNotificationsReadService();
      if (res && res.success) { items.forEach((n) => { n.leida = true; }); renderList(); refreshUnread(); showToast('Avisos marcados como leídos', 'success'); }
      else showToast(res?.message || 'No se pudo actualizar', 'danger');
    } else if (choice === 'delete') {
      const ok = await showActionSheet({
        title: '¿Eliminar todos los avisos?',
        message: 'Esta acción no se puede deshacer.',
        actions: [{ label: 'Eliminar todo', value: 'yes', style: 'destructive' }]
      });
      if (ok !== 'yes') return;
      const res = await deleteAllNotificationsService();
      if (res && res.success) { items = []; renderList(); refreshUnread(); showToast('Avisos eliminados', 'success'); }
      else showToast(res?.message || 'No se pudieron eliminar', 'danger');
    }
  });

  load();
  loadAnnouncements();
}
