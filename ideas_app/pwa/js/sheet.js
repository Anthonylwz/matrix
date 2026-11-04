// Hojas modales (bottom sheets) y action sheets con física estilo iOS.
//
// - Un resorte (amortiguamiento + respuesta, como los de Apple) mueve la hoja.
//   Siempre parte del valor actual y conserva la velocidad: se puede agarrar a mitad
//   de una animación y lanzar en otra dirección sin saltos.
// - Arrastre 1:1 con Pointer Events; al soltar se proyecta el momentum para decidir
//   si la hoja se cierra o vuelve a su sitio.
// - Rubber-band al tirar hacia arriba (o hacia abajo si la hoja no se puede cerrar).
//
// Estructura esperada: .sheet-backdrop > (.sheet | .action-sheet)

const SPRING_DEFAULT = { damping: 1, response: 0.38 };   // críticamente amortiguado
const SPRING_CLOSE = { damping: 1, response: 0.32 };
const SPRING_MOMENTUM = { damping: 0.8, response: 0.3 };  // rebote solo tras un lanzamiento
const DECELERATION = 0.995;
const DRAG_THRESHOLD = 8;          // px antes de decidir que es un arrastre
const FLICK_VELOCITY = 1100;       // px/s hacia abajo que cierran la hoja aunque se mueva poco
const DRAG_HANDLES = '.sheet__grabber, .sheet__header, .sheet__nav, .action-sheet__header';
const NO_DRAG = 'input, textarea, select, button, a, label, [contenteditable], [data-no-drag]';

const controllers = new WeakMap();
const openStack = [];
let escListenerBound = false;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Proyección de Apple (Designing Fluid Interfaces): dónde terminaría el gesto
function project(velocity, decelerationRate = DECELERATION) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

// Resistencia progresiva más allá del límite
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Resorte integrado numéricamente; se puede redirigir en cualquier momento
class Spring {
  constructor(onUpdate) {
    this.x = 0;
    this.v = 0;
    this.raf = null;
    this.onUpdate = onUpdate;
  }

  get animating() {
    return this.raf !== null;
  }

  set(x) {
    this.stop();
    this.x = x;
    this.v = 0;
    this.onUpdate(x);
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  animateTo(target, { damping, response, velocity }, onRest) {
    this.stop();
    if (typeof velocity === 'number') this.v = velocity;

    // Si la app no se está pintando, ir directo al destino
    if (document.hidden) {
      this.x = target;
      this.v = 0;
      this.onUpdate(target);
      if (onRest) onRest();
      return;
    }

    const w0 = (2 * Math.PI) / response;
    const k = w0 * w0;
    const c = 2 * damping * w0;
    let last = performance.now();

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.064);
      last = now;
      const substeps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / substeps;
      for (let i = 0; i < substeps; i++) {
        const a = -k * (this.x - target) - c * this.v;
        this.v += a * h;
        this.x += this.v * h;
      }

      if (Math.abs(this.x - target) < 0.5 && Math.abs(this.v) < 8) {
        this.x = target;
        this.v = 0;
        this.onUpdate(target);
        this.raf = null;
        if (onRest) onRest();
        return;
      }
      this.onUpdate(this.x);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

function getController(backdrop) {
  let c = controllers.get(backdrop);
  if (c) return c;

  const panel = backdrop.querySelector('.sheet, .action-sheet');
  c = {
    backdrop,
    panel,
    height: 0,
    open: false,
    guard: null,
    onClose: null,
    returnFocus: null,
    closing: null,
    spring: null
  };
  c.spring = new Spring((y) => render(c, y));
  controllers.set(backdrop, c);

  backdrop.setAttribute('role', 'presentation');
  if (panel) {
    if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  }

  // Tocar el fondo pide cerrar. Solo cuenta si el toque empezó en el fondo:
  // un arrastre de la hoja que termina fuera de ella no es un toque al fondo.
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === backdrop;
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && downOnBackdrop) requestDismiss(c, 0);
    downOnBackdrop = false;
  });

  bindDrag(c);
  return c;
}

function isDismissible(c) {
  return c.backdrop.dataset.dismissible !== 'false';
}

function render(c, y) {
  if (!c.panel) return;
  c.panel.style.transform = `translate3d(0, ${y}px, 0)`;
  const h = c.height || 1;
  const progress = Math.min(1, Math.max(0, 1 - y / h));
  c.backdrop.style.setProperty('--sheet-progress', progress.toFixed(3));
}

// Con teclado abierto (iOS), la hoja se apoya sobre el área visible
function fitToVisualViewport(c) {
  const vv = window.visualViewport;
  if (!vv || !c.open) {
    c.backdrop.style.removeProperty('height');
    c.backdrop.style.removeProperty('top');
    return;
  }
  c.backdrop.style.top = `${vv.offsetTop}px`;
  c.backdrop.style.height = `${vv.height}px`;
}

function onViewportChange() {
  openStack.forEach(fitToVisualViewport);
}

function bindDrag(c) {
  const { panel } = c;
  if (!panel) return;

  let pointerId = null;
  let startClientY = 0;
  let startClientX = 0;
  let startY = 0;
  let tracking = false;
  let history = [];

  const displayFor = (raw) => {
    if (raw < 0) return -rubberband(-raw, c.height);
    if (!isDismissible(c)) return rubberband(raw, c.height);
    return raw;
  };

  // Valor "crudo" equivalente a una posición mostrada (para agarrar en pleno rebote)
  const rawFor = (display) => (display < 0 ? -display / Math.max(0.2, 1 + display / c.height) : display);

  panel.addEventListener('pointerdown', (e) => {
    if (!c.open || e.button > 0) return;
    const onHandle = Boolean(e.target.closest(DRAG_HANDLES));
    if (!onHandle && e.target.closest(NO_DRAG)) return;
    // En hojas con desplazamiento interno, el cuerpo desplaza y solo el asa arrastra
    if (!onHandle && panel.scrollHeight > panel.clientHeight + 1 && e.pointerType === 'touch') return;
    if (!onHandle && panel.scrollTop > 0) return;

    // Con mouse, arrastrar desde el asa no debe seleccionar texto
    if (onHandle && e.pointerType === 'mouse') e.preventDefault();

    pointerId = e.pointerId;
    startClientY = e.clientY;
    startClientX = e.clientX;
    // Agarrar a mitad de una animación: se detiene y se sigue desde donde está
    tracking = c.spring.animating;
    c.spring.stop();
    startY = rawFor(c.spring.x);
    history = [{ y: c.spring.x, t: e.timeStamp }];
    if (tracking) panel.setPointerCapture(pointerId);
  });

  panel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dy = e.clientY - startClientY;
    if (!tracking) {
      const dx = e.clientX - startClientX;
      if (Math.abs(dy) < DRAG_THRESHOLD || Math.abs(dy) < Math.abs(dx)) return;
      tracking = true;
      // Se descuenta el umbral para que la hoja no salte al empezar a seguir el dedo
      startClientY += Math.sign(dy) * DRAG_THRESHOLD;
      try { panel.setPointerCapture(pointerId); } catch (_) {}
    }
    e.preventDefault();
    const display = displayFor(startY + (e.clientY - startClientY));
    c.spring.set(display);
    history.push({ y: display, t: e.timeStamp });
    if (history.length > 6) history.shift();
  });

  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (!tracking) return;
    tracking = false;

    // Velocidad con las últimas muestras (~100 ms)
    const last = history[history.length - 1];
    let first = history[0];
    for (const s of history) {
      if (last.t - s.t <= 100) { first = s; break; }
    }
    const dt = (last.t - first.t) / 1000;
    const velocity = dt > 0 ? (last.y - first.y) / dt : 0;

    const projected = c.spring.x + project(velocity);
    const wantsClose = velocity > 0 && (projected > c.height * 0.5 || velocity > FLICK_VELOCITY);

    if (wantsClose && isDismissible(c)) {
      requestDismiss(c, velocity);
    } else {
      snapBack(c, velocity);
    }
  };

  panel.addEventListener('pointerup', release);
  panel.addEventListener('pointercancel', release);
}

function snapBack(c, velocity = 0) {
  const spring = Math.abs(velocity) > 300 ? SPRING_MOMENTUM : SPRING_DEFAULT;
  c.spring.animateTo(0, { ...spring, velocity });
}

// Cierre pedido por el usuario (fondo, Escape, arrastre, Cancelar): respeta la guarda
async function requestDismiss(c, velocity = 0) {
  if (!c.open) return false;
  if (!isDismissible(c)) {
    snapBack(c, velocity);
    return false;
  }
  if (c.guard) {
    snapBack(c, velocity);
    const allowed = await c.guard();
    if (!allowed) return false;
    await closeSheet(c.backdrop);
    return true;
  }
  await closeSheet(c.backdrop, { velocity });
  return true;
}

function bindEscape() {
  if (escListenerBound) return;
  escListenerBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || openStack.length === 0) return;
    requestDismiss(openStack[openStack.length - 1], 0);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportChange);
    window.visualViewport.addEventListener('scroll', onViewportChange);
  }
}

/**
 * Abre una hoja.
 * @param {HTMLElement} backdrop .sheet-backdrop
 * @param {{ canDismiss?: () => boolean|Promise<boolean>, onClose?: () => void, focus?: HTMLElement }} options
 */
export function openSheet(backdrop, options = {}) {
  if (!backdrop) return;
  const c = getController(backdrop);
  bindEscape();

  c.guard = options.canDismiss || null;
  c.onClose = options.onClose || null;
  if (c.open) return;

  // Reabrir mientras se cerraba: se cancela ese cierre y el resorte sigue desde donde iba
  const reopening = Boolean(c.finishNow);
  c.finishNow = null;
  c.closing = null;

  c.open = true;
  c.returnFocus = document.activeElement;
  openStack.push(c);

  // Mientras está abierta vive en <body>: así ninguna vista en transición ni la tab bar la tapan
  if (backdrop.parentNode !== document.body) {
    c.home = backdrop.parentNode;
    c.homeNext = backdrop.nextSibling;
    document.body.appendChild(backdrop);
  } else if (!c.home) {
    c.home = document.body;
  }

  backdrop.hidden = false;
  fitToVisualViewport(c);
  c.height = c.panel ? c.panel.offsetHeight : 0;

  // Si el contenido no desplaza, toda la hoja se puede arrastrar también en pantallas táctiles
  if (c.panel) {
    const scrollable = c.panel.scrollHeight > c.panel.clientHeight + 1;
    c.panel.classList.toggle('is-draggable', !scrollable);
  }

  if (prefersReducedMotion()) {
    c.spring.set(0);
  } else {
    // Al reabrir a mitad de un cierre se parte de la posición y velocidad actuales
    if (!reopening) c.spring.set(c.height);
    c.spring.animateTo(0, SPRING_DEFAULT);
  }

  const focusTarget = options.focus || c.panel;
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

/**
 * Cierra una hoja sin preguntar (tras enviar un formulario, por ejemplo).
 * Devuelve una promesa que se resuelve cuando la hoja ya está oculta.
 */
export function closeSheet(backdrop, { velocity = 0 } = {}) {
  if (!backdrop) return Promise.resolve();
  const c = controllers.get(backdrop);
  if (!c || !c.open) return c && c.closing ? c.closing : Promise.resolve();

  c.open = false;
  const idx = openStack.indexOf(c);
  if (idx >= 0) openStack.splice(idx, 1);

  c.closing = new Promise((resolve) => {
    const finish = () => {
      if (c.finished) return;
      c.finished = true;
      finalize(c);
      resolve();
    };
    c.finished = false;
    c.finishNow = finish;

    c.height = c.panel ? c.panel.offsetHeight : c.height;
    if (prefersReducedMotion()) {
      finish();
    } else {
      c.spring.animateTo(c.height, { ...SPRING_CLOSE, velocity }, finish);
      // Respaldo: si la página deja de pintar cuadros (pantalla apagada), el cierre igual termina
      setTimeout(() => { if (c.finishNow === finish) finish(); }, 1200);
    }
  });
  return c.closing;
}

// Oculta la hoja y la devuelve a su lugar original en la página
function finalize(c) {
  const { backdrop } = c;
  c.spring.stop();
  backdrop.hidden = true;
  if (c.panel) c.panel.style.removeProperty('transform');
  backdrop.style.removeProperty('--sheet-progress');
  fitToVisualViewport(c);
  c.closing = null;
  c.finishNow = null;

  if (c.home && c.home !== document.body) {
    if (c.home.isConnected) {
      const next = c.homeNext && c.homeNext.parentNode === c.home ? c.homeNext : null;
      c.home.insertBefore(backdrop, next);
    } else {
      // La pantalla dueña ya no existe
      backdrop.remove();
    }
  }

  const prev = c.returnFocus;
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true });
  if (c.onClose) c.onClose();
}

/** Cierra al instante todas las hojas (al cambiar de pantalla). */
export function closeAllSheets() {
  [...openStack].forEach((c) => {
    if (c.open) closeSheet(c.backdrop);
  });
  // Termina sin animación las que estaban abiertas o cerrándose
  document.querySelectorAll('body > .sheet-backdrop').forEach((backdrop) => {
    const c = controllers.get(backdrop);
    if (c && c.finishNow) c.finishNow();
  });
}

/** Cierre como si lo pidiera el usuario: pasa por la guarda (p. ej. "¿Descartar cambios?"). */
export function dismissSheet(backdrop) {
  const c = backdrop && controllers.get(backdrop);
  return c ? requestDismiss(c, 0) : Promise.resolve(false);
}

/** Atrás de Android: cierra la hoja de más arriba (pasando por su guarda). true si había una. */
export function dismissTopSheet() {
  const top = openStack[openStack.length - 1];
  if (!top) return false;
  if (top.backdrop.dataset.dismissible === 'false') {
    // Hojas que no se cierran solas (resultado de marcación): Atrás equivale a su botón principal
    const primary = top.backdrop.querySelector('.ios-btn-primary');
    if (primary && !primary.disabled) primary.click();
    return true;
  }
  requestDismiss(top, 0);
  return true;
}

export function isSheetOpen(backdrop) {
  const c = backdrop && controllers.get(backdrop);
  return Boolean(c && c.open);
}

function formSnapshot(form) {
  return Array.from(form.elements)
    .map((el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value))
    .join('\u0001');
}

/**
 * Abre una hoja con formulario. Si el usuario editó algo y la cierra sin enviar
 * (Cancelar, arrastre, fondo o Escape) se le pregunta antes de descartar.
 * El formulario se reinicia al cerrarse.
 */
export function openFormSheet(backdrop, form, { onClose, focus } = {}) {
  if (!backdrop || !form) return;
  const initial = formSnapshot(form);
  openSheet(backdrop, {
    focus,
    canDismiss: async () => {
      if (formSnapshot(form) === initial) return true;
      const choice = await showActionSheet({
        actions: [{ label: 'Descartar cambios', value: 'discard', style: 'destructive' }],
        cancelLabel: 'Seguir editando'
      });
      return choice === 'discard';
    },
    onClose: () => {
      form.reset();
      if (onClose) onClose();
    }
  });
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/**
 * Action sheet estilo iOS. Resuelve con el `value` elegido o null si se cancela.
 * @param {{ title?: string, message?: string, actions: {label: string, value: any, style?: 'default'|'destructive'}[], cancelLabel?: string }} config
 */
export function showActionSheet({ title = '', message = '', actions = [], cancelLabel = 'Cancelar' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop sheet-backdrop--action';
    backdrop.hidden = true;

    const uid = `as-${Date.now().toString(36)}`;
    const header = (title || message)
      ? `<div class="action-sheet__header">
          ${title ? `<div class="action-sheet__title" id="${uid}-t">${escapeText(title)}</div>` : ''}
          ${message ? `<div class="action-sheet__message" id="${uid}-m">${escapeText(message)}</div>` : ''}
        </div>`
      : '';

    backdrop.innerHTML = `
      <div class="action-sheet" role="alertdialog" ${title ? `aria-labelledby="${uid}-t"` : ''} ${message ? `aria-describedby="${uid}-m"` : ''}>
        <div class="action-sheet__group">
          ${header}
          ${actions.map((a, i) => `
            <button type="button" class="action-sheet__btn${a.style === 'destructive' ? ' action-sheet__btn--destructive' : ''}" data-index="${i}">${escapeText(a.label)}</button>
          `).join('')}
        </div>
        <button type="button" class="action-sheet__btn action-sheet__cancel" data-cancel>${escapeText(cancelLabel)}</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    // La respuesta se entrega al tocar (no al terminar de cerrar) para que
    // lo que sigue, como cerrar la hoja de debajo, ocurra a la vez
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    backdrop.querySelector('.action-sheet').addEventListener('click', (e) => {
      const btn = e.target.closest('.action-sheet__btn');
      if (!btn) return;
      settle(btn.hasAttribute('data-index') ? actions[Number(btn.dataset.index)].value : null);
      closeSheet(backdrop);
    });

    openSheet(backdrop, {
      focus: backdrop.querySelector('[data-cancel]'),
      onClose: () => {
        backdrop.remove();
        settle(null);
      }
    });
  });
}
