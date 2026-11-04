// Utilidades generales y componentes UI rápidos

// Versión visible en Perfil. Mantener igual a CACHE_VERSION de service-worker.js
export const APP_VERSION = '4.1.8';

// Selector DOM abreviado
export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

// Muestra notificación flotante tipo Toast
// Íconos de los avisos (Lucide)
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
};

export function showToast(mensaje, tipo = 'info', duracion = 3200) {
  const container = $('#toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.setAttribute('role', tipo === 'danger' ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="toast__icon">${TOAST_ICONS[tipo] || TOAST_ICONS.info}</span>
    <span class="toast-text">${escapeHtml(mensaje)}</span>
  `;

  container.appendChild(toast);

  // La vibración se reserva para errores; el resto de avisos es solo visual
  if (tipo === 'danger') playFeedback('error');

  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

// Retroalimentación háptica con significado: éxito, aviso o error.
// Llamar en el mismo cuadro que la animación que la causa.
// (iOS Safari no expone la API de vibración: allí queda solo la animación.)
const FEEDBACK_PATTERNS = {
  success: [14, 70, 22],
  warning: [28],
  error: [40, 60, 40, 60, 40]
};

export function playFeedback(kind = 'success') {
  hapticFeedback(FEEDBACK_PATTERNS[kind] || FEEDBACK_PATTERNS.success);
}

// Hojas modales y action sheets: implementadas en sheet.js (física, gestos, guardas)
export { openSheet, openFormSheet, closeSheet, dismissSheet, isSheetOpen, showActionSheet } from './sheet.js';

// Botón de ojo en cada campo de contraseña para ver lo que se escribe
const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

export function enhancePasswordFields(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-eye])').forEach((input) => {
    input.dataset.eye = '1';
    const wrap = document.createElement('div');
    wrap.className = 'input-with-action';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'input-action';
    btn.setAttribute('aria-label', 'Mostrar contraseña');
    btn.innerHTML = EYE_OPEN;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_CLOSED : EYE_OPEN;
      btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      input.focus({ preventScroll: true });
    });
    wrap.appendChild(btn);
    // Al reiniciar el formulario se vuelve a ocultar
    input.form?.addEventListener('reset', () => {
      input.type = 'password';
      btn.innerHTML = EYE_OPEN;
    });
  });
}

// Fotos y archivos del servidor: el servidor devuelve direcciones absolutas http://IP/asistencia_ideas/...
// En la app (HTTPS interno) una imagen http se bloquea, así que se usa la ruta relativa al sistema.
export function resolveMediaUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, location.href);
    // Funciona con el sistema en una carpeta (XAMPP: /asistencia_ideas/public/...) o en la
    // raíz del dominio (nube: /public/...): se busca la carpeta de archivos del sistema.
    const m = u.pathname.match(/\/(public|uploads)\/.*/);
    if (m) return '..' + m[0] + u.search;
    return u.href;
  } catch (_) {
    return url;
  }
}

// Muestra un número contando desde 0 (si no es un entero, lo pone tal cual)
export function countUp(el, value, duration = 700) {
  if (!el) return;
  const target = Number(value);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!Number.isInteger(target) || target <= 0 || reduced) { el.textContent = String(value); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Marca como activo un elemento de un grupo (controles segmentados)
export function setActiveSegment(items, activeItem) {
  items.forEach((item) => {
    if (!item) return;
    const active = item === activeItem;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  moveSegmentThumb(activeItem);
}

// Píldora que se desliza bajo la opción activa del control segmentado
function moveSegmentThumb(activeItem) {
  const bar = activeItem && activeItem.closest('.segmented');
  if (!bar) return;
  let thumb = bar.querySelector(':scope > .segmented__thumb');
  const first = !thumb;
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'segmented__thumb';
    thumb.setAttribute('aria-hidden', 'true');
    bar.prepend(thumb);
  }
  const place = () => {
    if (!activeItem.offsetWidth) return;
    thumb.style.width = `${activeItem.offsetWidth}px`;
    thumb.style.transform = `translateX(${activeItem.offsetLeft}px)`;
  };
  // La primera vez se coloca sin animar; después se desliza
  if (first) {
    thumb.classList.add('no-anim');
    requestAnimationFrame(() => { place(); requestAnimationFrame(() => thumb.classList.remove('no-anim')); });
  } else {
    place();
  }
  if (!bar.dataset.thumbObserved && 'ResizeObserver' in window) {
    bar.dataset.thumbObserved = '1';
    new ResizeObserver(() => {
      const current = bar.querySelector('.segmented__item.is-active');
      if (current && current.offsetWidth) {
        thumb.style.width = `${current.offsetWidth}px`;
        thumb.style.transform = `translateX(${current.offsetLeft}px)`;
      }
    }).observe(bar);
  }
}

// Estado de conectividad compartido: cada pantalla dibuja su propia pastilla en la barra
let connectionState = { state: 'online', text: 'En línea' };

export function setConnectionStatus(state, text) {
  connectionState = { state, text };
  $$('.connection-pill').forEach(applyConnectionState);
}

function applyConnectionState(pill) {
  pill.className = `connection-pill ${connectionState.state}`;
  pill.setAttribute('aria-label', connectionState.text);
  const label = pill.querySelector('.connection-pill__text');
  if (label) label.textContent = connectionState.text;
}

export function connectionPillHTML() {
  const { state, text } = connectionState;
  return `<span class="connection-pill ${state}" role="status" aria-label="${escapeHtml(text)}"><span class="connection-dot"></span><span class="connection-pill__text">${escapeHtml(text)}</span></span>`;
}

// Íconos compartidos
export const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
export const ICON_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

// Vibración táctil suave en dispositivos móviles
export function hapticFeedback(pattern = [20]) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (_) {}
  }
}

// Sanitiza texto contra XSS
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Saludo dinámico según la hora del día
export function getGreeting() {
  // Hora de Lima, igual que en las apps de alumnos y personal (no depende de la zona del celular).
  let hora = new Date().getHours();
  try { hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', hourCycle: 'h23' }).format(new Date())); } catch (_) {}
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// Formateador de fecha legible (ej: Lunes, 21 de Septiembre)
export function formatDate(dateInput) {
  const today = dateInput === undefined;
  const date = today ? new Date() : typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  // «Hoy» se muestra en hora de Lima; una fecha recibida se formatea tal como llega.
  return date.toLocaleDateString('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(today ? { timeZone: 'America/Lima' } : {})
  });
}

// Formateador de hora (ej: 08:30)
export function formatTime(dateInput = new Date()) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return date.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// ── Fechas del servidor (YYYY-MM-DD) sin desfase de zona horaria ──
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Hoy", "Ayer" o "jue 15 oct"
export function formatDayLabel(iso, today = new Date()) {
  const d = parseDay(iso);
  if (!d) return iso || '';
  const ayer = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, ayer)) return 'Ayer';
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

// Partes para un bloque de fecha: { dia: '15', semana: 'JUE', mes: 'oct' }
export function dayParts(iso) {
  const d = parseDay(iso);
  if (!d) return { dia: '--', semana: '', mes: '' };
  return { dia: String(d.getDate()), semana: DIAS_CORTOS[d.getDay()].toUpperCase(), mes: MESES_CORTOS[d.getMonth()] };
}

// Lunes de la semana de una fecha (para agrupar el historial)
export function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

export function weekLabel(monday, today = new Date()) {
  const actual = weekStart(today);
  const diff = Math.round((actual - monday) / (7 * 86400000));
  if (diff === 0) return 'Esta semana';
  if (diff === 1) return 'Semana pasada';
  return `Semana del ${monday.getDate()} ${MESES_CORTOS[monday.getMonth()]}`;
}

// "08:10" o "08:10:00" → minutos
export function hhmmToMinutes(value) {
  const m = /^(\d{1,3}):(\d{2})/.exec(String(value || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// minutos → "8 h 10 min"
export function formatDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '';
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// Iniciales para el avatar: "María Quispe Huamán" → "MQ"
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}
