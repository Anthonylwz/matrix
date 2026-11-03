import { countUp, $, getGreeting, formatDate, formatTime, hhmmToMinutes, showToast, escapeHtml, openSheet, closeSheet, isSheetOpen, setActiveSegment, ICON_CLOSE, ICON_CHEVRON } from '../js/utils.js';
import { getUser } from '../js/auth.js';
import { getHistoryService, getJornadaService, checkServerStatus, horaLima, getPermissionsService, getCorrectionsService } from '../js/api.js';
import { icon, rowIcon } from '../js/icons.js';
import { cacheAttendanceHistory, getCachedAttendanceHistory, getPendingOperationsCount, getPendingOperations, getSyncLogs } from '../js/db.js';
import { syncPendingOperations } from '../js/sync.js';
import { bellButtonHTML, checkUrgentAnnouncement } from '../js/notifications.js';
import { prewarmLocation } from '../js/location.js';
import { getServerKey } from '../js/server-context.js';

// Los cuatro momentos de la jornada, en orden
const STEPS = [
  { key: 'entrada', field: 'hora_entrada', label: 'Entrada', action: 'Marcar entrada' },
  { key: 'almuerzo', field: 'hora_almuerzo', label: 'Almuerzo', action: 'Salir a almorzar' },
  { key: 'regreso_almuerzo', field: 'hora_regreso_almuerzo', label: 'Retorno', action: 'Marcar retorno' },
  { key: 'salida', field: 'hora_salida', label: 'Salida', action: 'Marcar salida' }
];

const DONE_STORAGE_KEY = 'home_timeline_done';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="12 7 12 12 15 14"/></svg>';

// Fecha sobre el Large Title "Hoy"
// Campana con el número de avisos sin leer (abre el centro de notificaciones)
export function navActions() {
  return bellButtonHTML();
}

export function kicker() {
  return formatDate();
}

// Circunferencia del anillo de horas (r = 42)
const RING_LENGTH = 2 * Math.PI * 42;
const JORNADA_MINUTOS = 8 * 60;

// La cifra cerrada pertenece al servidor. Durante la jornada sólo estimamos tiempo desde entrada.
export function workedMinutes(row, now = new Date()) {
  if (!row || !row.hora_entrada) return 0;
  if (row.hora_salida && row.horas_trabajadas) return Math.max(0, hhmmToMinutes(row.horas_trabajadas) || 0);
  const day = row.fecha || horaLima(now).slice(0, 10);
  const timestamp = (time) => new Date(`${day}T${String(time).slice(0, 8).padEnd(8, ':00')}-05:00`).getTime();
  const start = timestamp(row.hora_entrada);
  const end = row.hora_salida ? timestamp(row.hora_salida) : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 60000)) : 0;
}

export function render(container) {
  const user = getUser() || { nombre: 'Colaborador', dni: '' };
  const saludo = getGreeting();
  const nombreCorto = String(user.nombres || user.nombre || 'Colaborador').trim().split(/\s+/)[0];

  container.innerHTML = `
    <div class="page">
      <!-- Héroe: saludo, estado y horas trabajadas -->
      <section class="hero" aria-label="Resumen de hoy">
        <div>
          <div class="hero__greeting">${saludo},</div>
          <div class="hero__name">${escapeHtml(nombreCorto)}</div>
          <span id="home-hero-status" class="hero__status">Consultando…</span>
        </div>
        <div class="ring" id="home-ring" role="img" aria-label="Horas trabajadas hoy">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="ring__track" cx="50" cy="50" r="42" fill="none" stroke-width="9"/>
            <circle id="home-ring-value" class="ring__value" cx="50" cy="50" r="42" fill="none" stroke-width="9"
              stroke-dasharray="${RING_LENGTH.toFixed(1)}" stroke-dashoffset="${RING_LENGTH.toFixed(1)}"/>
          </svg>
          <div class="ring__label">
            <span id="home-ring-hours" class="ring__hours">0:00</span>
            <span id="home-ring-caption" class="ring__caption">Desde entrada</span>
          </div>
        </div>
      </section>

      <!-- Acción principal -->
      <a href="#scanner" class="cta">
        <span class="cta__icon">${icon('qr')}</span>
        <span class="cta__text">
          <span id="home-primary-label" class="cta__title">Escanear QR</span>
          <span class="cta__sub">Escanea el QR de la pantalla</span>
        </span>
        ${ICON_CHEVRON}
      </a>
      <a href="#scanner?manual" class="cta-secondary">${icon('keypad')}<span>Usar código de 6 dígitos</span></a>

      <!-- Jornada de hoy -->
      <div class="section-head">
        <span class="section-head__title">Tu jornada</span>
        <span class="ios-badge badge-neutral" id="home-current-status">Consultando…</span>
      </div>
      <div class="ios-card">
        <ol id="home-timeline" class="timeline" aria-label="Marcaciones de hoy">
          ${STEPS.map((s) => timelineStepHTML(s, { state: 'pending' })).join('')}
        </ol>

        <button type="button" id="btn-open-sync-sheet" class="sync-row">
          <span class="sync-row__label">Sincronización</span>
          <span id="home-sync-status-text" class="sync-row__status text-success">
            <span>Todo sincronizado</span>${ICON_CHEVRON}
          </span>
        </button>
      </div>

      <!-- Resumen de la semana -->
      <div class="section-head">
        <span class="section-head__title">Últimos 7 días</span>
        <a href="#history" class="section-head__link">Ver historial</a>
      </div>
      <div class="stats-row">
        <div class="stat-tile stat-tile--green">
          ${icon('calendar', 'stat-tile__icon')}
          <span id="home-week-days" class="stat-tile__value">–</span>
          <span class="stat-tile__label">Asistencias</span>
        </div>
        <div class="stat-tile stat-tile--orange">
          ${icon('clock', 'stat-tile__icon')}
          <span id="home-week-late" class="stat-tile__value">–</span>
          <span class="stat-tile__label">Tardanzas</span>
        </div>
        <div class="stat-tile stat-tile--accent">
          ${icon('chart', 'stat-tile__icon')}
          <span id="home-week-hours" class="stat-tile__value">–</span>
          <span class="stat-tile__label">Horas</span>
        </div>
      </div>
      <div id="home-week-punctuality" class="week-punctuality" hidden>
        <div class="week-punctuality__head"><span>Puntualidad</span><strong id="home-week-punctuality-value">–</strong></div>
        <div class="week-punctuality__bar"><span id="home-week-punctuality-bar"></span></div>
        <small id="home-week-punctuality-text"></small>
      </div>

      <!-- Solicitudes -->
      <div class="section-head">
        <span class="section-head__title">Solicitudes</span>
      </div>
      <div class="ios-card ios-card--flush list-group--icons">
        <a href="#requests" class="list-row">
          ${rowIcon('doc', 'orange')}
          <span class="list-row__main">
            <span>Permisos</span>
            <span class="list-row__sub">Salidas temporales y citas</span>
          </span>
          <span class="list-row__end"><span id="home-pending-permisos" class="count-badge" hidden></span>${ICON_CHEVRON}</span>
        </a>
        <a href="#requests?tab=correcciones" class="list-row">
          ${rowIcon('edit', 'blue')}
          <span class="list-row__main">
            <span>Correcciones</span>
            <span class="list-row__sub">Si olvidaste marcar o hubo un error</span>
          </span>
          <span class="list-row__end"><span id="home-pending-correcciones" class="count-badge" hidden></span>${ICON_CHEVRON}</span>
        </a>
      </div>
    </div>

    <!-- Hoja de Estado de Sincronización -->
    <div id="sync-sheet-modal" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="sync-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__header">
          <h3 id="sync-sheet-title" class="sheet__title">Sincronización</h3>
          <button type="button" id="btn-close-sync-sheet" class="icon-btn" aria-label="Cerrar">${ICON_CLOSE}</button>
        </div>

        <!-- Estado en tres fichas -->
        <div class="mini-stats section">
          <div class="mini-stat">
            ${icon('refresh', 'mini-stat__icon')}
            <span id="sheet-pending-count" class="kv-row__value tabular">0</span>
            <span class="mini-stat__label">Pendientes</span>
          </div>
          <div class="mini-stat">
            ${icon('smartphone', 'mini-stat__icon')}
            <span id="sheet-net-status" class="kv-row__value text-success">En línea</span>
            <span class="mini-stat__label">Internet</span>
          </div>
          <div class="mini-stat">
            ${icon('server', 'mini-stat__icon')}
            <span id="sheet-server-status" class="kv-row__value">…</span>
            <span class="mini-stat__label">Servidor</span>
          </div>
        </div>

        <!-- Pestañas: Pendientes | Sincronizados | Rechazados -->
        <div class="segmented" role="tablist">
          <button type="button" id="tab-sync-pending" class="segmented__item is-active" role="tab">Pendientes</button>
          <button type="button" id="tab-sync-synced" class="segmented__item" role="tab">Sincronizados</button>
          <button type="button" id="tab-sync-rejected" class="segmented__item" role="tab">Rechazados</button>
        </div>

        <!-- Lista dinámica de la pestaña activa -->
        <p id="sheet-retained-notice" class="inline-alert inline-alert--warning" hidden></p>
        <div id="sheet-sync-list" class="sheet-list"></div>

        <button type="button" id="btn-trigger-sync" class="ios-btn ios-btn-primary">
          <span>Sincronizar ahora</span>
        </button>
      </div>
    </div>
  `;
}

// Un paso del timeline. state: done | queued | next | pending
function timelineStepHTML(step, { state, time = '', late = false, fresh = false }) {
  const classes = ['timeline__step', `is-${state}`];
  if (late) classes.push('is-late');
  if (fresh) classes.push('is-fresh');

  let note = '';
  if (state === 'queued') note = 'En cola';
  else if (state === 'next') note = 'Siguiente';
  else if (late) note = 'Tarde';

  const stateText = {
    done: 'registrada',
    queued: 'guardada sin conexión',
    next: 'siguiente',
    pending: 'pendiente'
  }[state];

  return `
    <li class="${classes.join(' ')}" data-step="${step.key}" aria-label="${step.label}: ${time || stateText}${late ? ', tarde' : ''}">
      <span class="timeline__dot">${state === 'done' ? ICON_CHECK : state === 'queued' ? ICON_CLOCK : ''}</span>
      <span class="timeline__label">${step.label}</span>
      <span class="timeline__time">${time || '--:--'}</span>
      <span class="timeline__note">${note}</span>
    </li>
  `;
}

function readDoneKeys() {
  try { return JSON.parse(sessionStorage.getItem(`${DONE_STORAGE_KEY}|${getServerKey()}|${getUser()?.id}|${horaLima().slice(0, 10)}`) || '[]'); } catch (_) { return []; }
}

function writeDoneKeys(keys) {
  try { sessionStorage.setItem(`${DONE_STORAGE_KEY}|${getServerKey()}|${getUser()?.id}|${horaLima().slice(0, 10)}`, JSON.stringify(keys)); } catch (_) {}
}

export async function init() {
  const owner = `${getServerKey()}|${getUser()?.id || ''}`;
  const statusEl = $('#home-current-status');
  const timelineEl = $('#home-timeline');
  const primaryLabel = $('#home-primary-label');
  const syncText = $('#home-sync-status-text');
  const heroStatus = $('#home-hero-status');
  const ringValue = $('#home-ring-value');
  const ringHours = $('#home-ring-hours');
  const ring = $('#home-ring');

  // El anillo de horas se recalcula cada minuto mientras la jornada está en curso
  let todayRow = null;
  let clockDay = horaLima().slice(0, 10);
  const refreshClock = () => {
    if (document.hidden) return;
    const day = horaLima().slice(0, 10);
    if (day !== clockDay) {
      clockDay = day;
      todayRow = null;
      weekRequest = null;
      loadTodayData();
      loadWeek();
    }
    updateHero(todayRow);
  };
  const clockTimer = setInterval(refreshClock, 60000);
  document.addEventListener('visibilitychange', refreshClock);

  function updateHero(row, offline = false) {
    const minutes = workedMinutes(row);
    const progress = Math.min(1, minutes / JORNADA_MINUTOS);
    if (ringValue) ringValue.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - progress)).toFixed(1));
    if (ringHours) ringHours.textContent = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const caption = row?.hora_salida ? 'Horas registradas' : 'Desde entrada';
    const captionEl = $('#home-ring-caption');
    if (captionEl) captionEl.textContent = caption;
    if (ring) ring.setAttribute('aria-label', `${caption}: ${Math.floor(minutes / 60)} horas y ${minutes % 60} minutos`);

    if (!heroStatus) return;
    let text = 'Aún no marcas tu entrada';
    let cls = '';
    if (row && row.hora_salida) {
      text = `Jornada completa · ${row.hora_salida.slice(0, 5)}`;
    } else if (row && row.hora_almuerzo && !row.hora_regreso_almuerzo) {
      text = `En almuerzo desde ${row.hora_almuerzo.slice(0, 5)}`;
      cls = 'is-pause';
    } else if (row && row.hora_regreso_almuerzo) {
      text = `En jornada · volviste ${row.hora_regreso_almuerzo.slice(0, 5)}`;
      cls = 'is-live';
    } else if (row && row.hora_entrada) {
      text = `En jornada desde ${row.hora_entrada.slice(0, 5)}`;
      cls = 'is-live';
    } else if (offline) {
      text = 'Sin conexión';
    }
    heroStatus.textContent = text;
    heroStatus.className = `hero__status ${cls}`;
  }

  // Una sola petición de la semana sirve para el resumen y para el registro de hoy
  let weekRequest = null;
  const getWeek = () => {
    if (!weekRequest) weekRequest = getHistoryService('semana').catch(() => ({ success: false }));
    return weekRequest;
  };

  // Resumen de la semana
  async function loadWeek() {
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    try {
      const res = await getWeek();
      if (!res.success || !res.data) return;
      const list = Array.isArray(res.data.historial) ? res.data.historial : [];
      const r = res.data.resumen || {};
      const late = r.total_tardanzas ?? list.filter((x) => x.estado_entrada && x.estado_entrada.includes('tarde')).length;
      countUp($('#home-week-days'), r.total_asistencias ?? list.filter((x) => x.hora_entrada).length);
      countUp($('#home-week-late'), late);
      set('#home-week-hours', String(r.horas_trabajadas || '0:00').replace(/^0(\d:)/, '$1'));
      // Puntualidad: días con entrada a tiempo sobre los días con asistencia
      const days = Number(r.total_asistencias ?? list.filter((x) => x.hora_entrada).length) || 0;
      const box = $('#home-week-punctuality');
      if (box && days > 0) {
        const onTime = Math.max(0, days - (Number(late) || 0));
        const pct = Math.round((onTime * 100) / days);
        set('#home-week-punctuality-value', `${pct}%`);
        set('#home-week-punctuality-text', `${onTime} de ${days} día${days === 1 ? '' : 's'} con entrada a tiempo${pct === 100 ? ' · ¡Excelente!' : ''}`);
        const bar = $('#home-week-punctuality-bar');
        if (bar) { bar.style.width = `${pct}%`; bar.dataset.tone = pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'low'; }
        box.hidden = false;
      }
    } catch (_) {}
  }

  // Cuántas solicitudes siguen pendientes de respuesta
  async function loadPendingRequests() {
    const show = (id, n) => {
      const el = $(id);
      if (!el) return;
      el.textContent = String(n);
      el.hidden = !n;
    };
    try {
      const [p, c] = await Promise.all([getPermissionsService(), getCorrectionsService()]);
      const pend = (list) => (Array.isArray(list) ? list.filter((x) => !x.estado || x.estado === 'pendiente').length : 0);
      show('#home-pending-permisos', p && p.success && p.data ? pend(p.data.permisos) : 0);
      show('#home-pending-correcciones', c && c.success && c.data ? pend(c.data.correcciones) : 0);
    } catch (_) {}
  }

  // Comprobar pendientes en IndexedDB
  async function updateSyncBadge() {
    const pending = await getPendingOperationsCount();
    const retained = (await getPendingOperations({ retained: true })).length;
    if (!syncText) return;
    if (pending > 0) {
      syncText.className = 'sync-row__status text-warning';
      syncText.innerHTML = `<span>${pending} pendiente${pending > 1 ? 's' : ''}</span>${ICON_CHEVRON}`;
    } else if (retained) {
      syncText.className = 'sync-row__status text-warning';
      syncText.innerHTML = `<span>${retained} retenida${retained > 1 ? 's' : ''}</span>${ICON_CHEVRON}`;
    } else {
      syncText.className = 'sync-row__status text-success';
      syncText.innerHTML = `<span>Todo sincronizado</span>${ICON_CHEVRON}`;
    }
  }
  updateSyncBadge();

  function setStatus(text, variant) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `ios-badge ${variant}`;
  }

  // Registro de hoy: servidor, o caché local si no hay conexión
  async function fetchTodayRow() {
    const hoyStr = horaLima().slice(0, 10);
    try {
      const res = await getWeek();
      if (res.success && res.data && Array.isArray(res.data.historial)) {
        // Copia local para ver la jornada y el historial sin conexión
        cacheAttendanceHistory(res.data.historial, { replace: false });
        return { row: res.data.historial.find((h) => h.fecha === hoyStr) || null, online: true };
      }
    } catch (_) {}
    try {
      const cached = await getCachedAttendanceHistory();
      return { row: cached.find((c) => c.fecha === hoyStr) || null, online: false };
    } catch (_) {
      return { row: null, online: false };
    }
  }

  async function fetchNextTipo() {
    try {
      const res = await getJornadaService();
      if (res.success && res.data && res.data.tipo) return res.data.tipo;
    } catch (_) {}
    return null;
  }

  // Marcaciones de hoy guardadas sin conexión, por tipo
  async function fetchQueuedToday() {
    const hoyStr = horaLima().slice(0, 10);
    const queued = {};
    try {
      const me = String((getUser() || {}).id || '');
      const ops = (await getPendingOperations()).filter((o) =>
        String(o.trabajador_id || o.user_id) === me &&
        (o.estado === 'pendiente' || o.estado === 'syncing') &&
        (!o.timestamp_dispositivo || o.timestamp_dispositivo.slice(0, 10) === hoyStr)
      );
      ops.forEach((op) => {
        const hora = op.timestamp_dispositivo ? op.timestamp_dispositivo.slice(11, 16) : '';
        queued[op.tipo || 'auto'] = hora;
      });
    } catch (_) {}
    return queued;
  }

  async function loadTodayData() {
    const [{ row, online }, serverNext, queued] = await Promise.all([fetchTodayRow(), fetchNextTipo(), fetchQueuedToday()]);
    if (owner !== `${getServerKey()}|${getUser()?.id || ''}`) return;

    // Estado de cada paso
    const states = STEPS.map((step) => {
      const hora = row && row[step.field] ? row[step.field].slice(0, 5) : '';
      if (hora) {
        const late = step.key === 'entrada' && Boolean(row.estado_entrada && row.estado_entrada.includes('tarde'));
        return { step, state: 'done', time: hora, late };
      }
      if (queued[step.key] !== undefined) return { step, state: 'queued', time: queued[step.key] };
      return { step, state: 'pending', time: '' };
    });

    // Una marcación "automática" en cola ocupa el primer paso libre
    if (queued.auto !== undefined) {
      const free = states.find((s) => s.state === 'pending');
      if (free) Object.assign(free, { state: 'queued', time: queued.auto });
    }

    // Paso siguiente: el que indica el servidor, o el primero libre
    let next = serverNext ? states.find((s) => s.step.key === serverNext && s.state === 'pending') : null;
    if (!next) next = states.find((s) => s.state === 'pending') || null;
    if (next) next.state = 'next';

    // Animar solo los pasos que se completaron desde la última vez que se vio la pantalla
    const previouslyDone = readDoneKeys();
    const doneNow = states.filter((s) => s.state === 'done' || s.state === 'queued').map((s) => s.step.key);
    const fresh = new Set(doneNow.filter((k) => !previouslyDone.includes(k)));
    writeDoneKeys(doneNow);

    if (timelineEl) {
      timelineEl.innerHTML = states
        .map((s) => timelineStepHTML(s.step, { state: s.state, time: s.time, late: s.late, fresh: previouslyDone.length > 0 && fresh.has(s.step.key) }))
        .join('');
    }

    // Etiqueta del botón principal según lo que toca marcar
    if (primaryLabel) primaryLabel.textContent = next ? next.step.action : 'Escanear QR';

    // Resumen en la insignia
    const anyQueued = states.some((s) => s.state === 'queued');
    const entrada = states[0];
    const salida = states[3];
    if (anyQueued) {
      setStatus('Marcación en cola', 'badge-warning');
    } else if (salida.state === 'done') {
      setStatus('Completa', 'badge-success');
    } else if (entrada.state === 'done') {
      setStatus(entrada.late ? 'Entrada tarde' : 'Puntual', entrada.late ? 'badge-warning' : 'badge-success');
    } else if (!online && !row) {
      setStatus('Sin conexión', 'badge-neutral');
    } else {
      setStatus('Sin marcar', 'badge-neutral');
    }

    todayRow = row;
    // Android: con la salida ya registrada, hoy no suena el recordatorio de salida
    if (row && row.hora_salida) {
      try { window.AndroidNet?.markExitDone?.(horaLima().slice(0, 10)); } catch (_) {}
    }
    updateHero(row, !online && !row);
  }

  loadTodayData();
  loadWeek();
  loadPendingRequests();
  checkUrgentAnnouncement();
  // La ubicación se busca desde ya: al ir a marcar suele estar lista (si hay permiso)
  setTimeout(() => { if (!document.hidden) prewarmLocation(); }, 800);

  // Hoja de Sincronización
  const btnOpenSync = $('#btn-open-sync-sheet');
  const syncModal = $('#sync-sheet-modal');
  const btnCloseSync = $('#btn-close-sync-sheet');
  const btnTriggerSync = $('#btn-trigger-sync');
  const sheetPending = $('#sheet-pending-count');
  const sheetNet = $('#sheet-net-status');
  const sheetServer = $('#sheet-server-status');
  const sheetList = $('#sheet-sync-list');
  const tabPending = $('#tab-sync-pending');
  const tabSynced = $('#tab-sync-synced');
  const tabRejected = $('#tab-sync-rejected');
  const syncTabs = [tabPending, tabSynced, tabRejected];

  let activeSyncTab = 'pending';

  function emptyNote(text) {
    return `<div class="empty-note">${text}</div>`;
  }

  async function renderSyncTabContent(tab) {
    if (!sheetList) return;
    activeSyncTab = tab;
    setActiveSegment(syncTabs, tab === 'pending' ? tabPending : tab === 'synced' ? tabSynced : tabRejected);

    if (tab === 'pending') {
      const all = await getPendingOperations();
      const list = all.filter((o) => o.estado === 'pendiente' || o.estado === 'syncing' || o.estado === 'error');
      if (list.length === 0) {
        sheetList.innerHTML = emptyNote('No hay marcaciones pendientes. Todos tus datos están respaldados.');
        return;
      }
      sheetList.innerHTML = list.map((op) => {
        const hora = op.timestamp_dispositivo ? op.timestamp_dispositivo.slice(11, 16) : '--:--';
        const fecha = op.timestamp_dispositivo ? op.timestamp_dispositivo.slice(0, 10) : '';
        return `
          <div class="sync-item row-between">
            <div>
              <div class="sync-item__title">${escapeHtml(op.tipo || 'Marcación')}</div>
              <div class="sync-item__meta">${fecha} a las ${hora} (${op.metodo === 'qr' ? 'QR' : 'Código'})</div>
            </div>
            <span class="ios-badge badge-warning">${op.estado === 'syncing' ? 'Sincronizando' : 'Pendiente'}</span>
          </div>
        `;
      }).join('');
    } else if (tab === 'synced') {
      const logs = await getSyncLogs();
      const synced = logs.filter((l) => l.estado === 'synced');
      if (synced.length === 0) {
        sheetList.innerHTML = emptyNote('Aún no se registran sincronizaciones en esta sesión.');
        return;
      }
      sheetList.innerHTML = synced.map((item) => {
        const hora = item.timestamp ? item.timestamp.slice(11, 16) : '--:--';
        return `
          <div class="sync-item row-between">
            <div>
              <div class="sync-item__title">${escapeHtml(item.tipo || 'Marcación')}</div>
              <div class="sync-item__meta">Sincronizado a las ${hora}</div>
            </div>
            <span class="ios-badge badge-success">Sincronizado</span>
          </div>
        `;
      }).join('');
    } else if (tab === 'rejected') {
      const all = await getPendingOperations();
      const rejected = all.filter((o) => o.estado === 'rejected' || o.estado === 'error');
      if (rejected.length === 0) {
        sheetList.innerHTML = emptyNote('No hay marcaciones rechazadas o con error.');
        return;
      }
      sheetList.innerHTML = rejected.map((item) => {
        const hora = item.timestamp_dispositivo ? item.timestamp_dispositivo.slice(11, 16) : '--:--';
        return `
          <div class="sync-item sync-item--danger">
            <div class="row-between">
              <span class="sync-item__title">${escapeHtml(item.tipo || 'Marcación')} (${escapeHtml(hora)})</span>
              <span class="ios-badge badge-danger">${item.estado === 'rejected' ? 'Rechazado' : 'Error'}</span>
            </div>
            <div class="sync-item__error">${escapeHtml(item.ultimo_error || 'Rechazada por el servidor')}</div>
          </div>
        `;
      }).join('');
    }
  }

  if (tabPending) tabPending.addEventListener('click', () => renderSyncTabContent('pending'));
  if (tabSynced) tabSynced.addEventListener('click', () => renderSyncTabContent('synced'));
  if (tabRejected) tabRejected.addEventListener('click', () => renderSyncTabContent('rejected'));

  if (btnOpenSync && syncModal) {
    btnOpenSync.addEventListener('click', async () => {
      openSheet(syncModal);
      const pending = await getPendingOperationsCount();
      const retained = (await getPendingOperations({ retained: true })).length;
      const retainedNotice = $('#sheet-retained-notice');
      if (retainedNotice) {
        retainedNotice.hidden = !retained;
        retainedNotice.textContent = `${retained} marcación${retained === 1 ? '' : 'es'} de una versión anterior se conserva${retained === 1 ? '' : 'n'} en este celular. Su servidor de origen no está identificado; no se enviarán automáticamente. Contacta al administrador para revisarlas.`;
      }
      if (sheetPending) sheetPending.textContent = String(pending);
      if (sheetNet) {
        sheetNet.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
        sheetNet.className = `kv-row__value ${navigator.onLine ? 'text-success' : 'text-danger'}`;
      }
      await renderSyncTabContent('pending');
      if (sheetServer) {
        try {
          const s = await checkServerStatus();
          const ok = Boolean(s && s.success);
          sheetServer.textContent = ok ? 'Conectado' : 'No responde';
          sheetServer.className = `kv-row__value ${ok ? 'text-success' : 'text-danger'}`;
        } catch (_) {
          sheetServer.textContent = 'Sin conexión';
          sheetServer.className = 'kv-row__value text-danger';
        }
      }
    });
  }

  if (btnCloseSync) btnCloseSync.addEventListener('click', () => closeSheet(syncModal));
  if (new URLSearchParams(window.location.hash.split('?')[1] || '').has('sync')) btnOpenSync?.click();

  if (btnTriggerSync) {
    btnTriggerSync.addEventListener('click', async () => {
      if (!navigator.onLine) {
        showToast('No tienes conexión a Internet para sincronizar.', 'warning');
        return;
      }
      btnTriggerSync.disabled = true;
      btnTriggerSync.textContent = 'Sincronizando...';
      try {
        await syncPendingOperations();
        await updateSyncBadge();
        weekRequest = null;
        await loadTodayData();
        await renderSyncTabContent(activeSyncTab);
      } catch (_) {
        showToast('No se pudo completar la sincronización', 'danger');
      } finally {
        btnTriggerSync.disabled = false;
        btnTriggerSync.textContent = 'Sincronizar ahora';
      }
    });
  }

  // Sincronizaciones automáticas en segundo plano
  const onSyncCompleted = async () => {
    await updateSyncBadge();
    weekRequest = null;
    await loadTodayData();
    if (isSheetOpen(syncModal)) {
      await renderSyncTabContent(activeSyncTab);
    }
  };
  window.addEventListener('sync:completed', onSyncCompleted);

  // Novedades del servidor (respuesta a una solicitud, marcación hecha en otro equipo)
  const onAppChanged = () => {
    weekRequest = null;
    loadTodayData();
    loadWeek();
    loadPendingRequests();
  };
  window.addEventListener('app:changed', onAppChanged);
  window.addEventListener('hashchange', () => window.removeEventListener('app:changed', onAppChanged), { once: true });

  // Al salir de la pantalla: detener reloj y soltar listeners globales
  window.addEventListener('hashchange', () => {
    clearInterval(clockTimer);
    document.removeEventListener('visibilitychange', refreshClock);
    window.removeEventListener('sync:completed', onSyncCompleted);
  }, { once: true });
}
