// Visor de imágenes a pantalla completa (comunicados, avisos, fotos):
// pellizcar para acercar, doble toque para acercar/alejar, arrastrar para mover,
// deslizar hacia abajo para cerrar y botón para descargar.
import { icon } from './icons.js';
import { showToast, hapticFeedback } from './utils.js';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
let open = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function openImageViewer(src, { title = '', fileName = '' } = {}) {
  if (!src || open) return;
  const root = document.createElement('div');
  root.className = 'img-viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title || 'Imagen');
  root.innerHTML = `
    <div class="img-viewer__bg"></div>
    <div class="img-viewer__stage"><img class="img-viewer__img" alt="${title.replace(/"/g, '&quot;')}" draggable="false"></div>
    <div class="img-viewer__bar">
      <button type="button" class="img-viewer__btn" data-close aria-label="Cerrar">${icon('close')}</button>
      ${title ? `<span class="img-viewer__title">${title.replace(/</g, '&lt;')}</span>` : '<span></span>'}
      <button type="button" class="img-viewer__btn" data-download aria-label="Descargar">${icon('download')}</button>
    </div>
    <p class="img-viewer__hint">Pellizca o toca dos veces para acercar</p>`;
  document.body.appendChild(root);
  const img = root.querySelector('.img-viewer__img');
  const bg = root.querySelector('.img-viewer__bg');
  img.src = src;

  // Estado de la transformación
  let scale = 1, tx = 0, ty = 0;
  const apply = (animate) => {
    img.style.transition = animate && !reduced() ? 'transform 260ms cubic-bezier(.2,.8,.2,1)' : 'none';
    img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  };
  const bounds = () => {
    const r = img.getBoundingClientRect();
    const w = r.width / scale, h = r.height / scale; // tamaño base
    const mx = Math.max(0, (w * scale - innerWidth) / 2);
    const my = Math.max(0, (h * scale - innerHeight) / 2);
    return { mx, my };
  };
  const settle = () => {
    if (scale <= 1.01) { scale = 1; tx = 0; ty = 0; } else {
      const { mx, my } = bounds();
      tx = clamp(tx, -mx, mx);
      ty = clamp(ty, -my, my);
    }
    apply(true);
  };

  // Gestos: un dedo arrastra (o cierra deslizando hacia abajo), dos dedos hacen zoom
  const pts = new Map();
  let start = null, lastTap = 0, dismissing = false;
  const onDown = (e) => {
    root.querySelector('.img-viewer__hint')?.classList.add('is-gone');
    img.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.values()];
    if (p.length === 2) {
      start = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), scale, tx, ty, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
    } else {
      start = { x: e.clientX, y: e.clientY, tx, ty, t: Date.now() };
      dismissing = scale <= 1.01;
    }
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.values()];
    if (p.length === 2 && start.dist) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const k = clamp(start.scale * d / start.dist, 1, MAX_SCALE);
      // Acerca hacia el punto entre los dedos
      const cx = (p[0].x + p[1].x) / 2 - innerWidth / 2, cy = (p[0].y + p[1].y) / 2 - innerHeight / 2;
      tx = cx - (cx - start.tx) * (k / start.scale);
      ty = cy - (cy - start.ty) * (k / start.scale);
      scale = k;
      apply(false);
    } else if (p.length === 1 && start.x !== undefined) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (dismissing) {
        ty = Math.max(0, dy) * 0.9;
        tx = dx * 0.25;
        bg.style.opacity = String(1 - Math.min(0.85, Math.max(0, dy) / 420));
        apply(false);
      } else {
        tx = start.tx + dx;
        ty = start.ty + dy;
        apply(false);
      }
    }
  };
  const onUp = (e) => {
    pts.delete(e.pointerId);
    if (pts.size > 0) {
      const q = [...pts.values()][0];
      start = { x: q.x, y: q.y, tx, ty, t: Date.now() };
      dismissing = false;
      return;
    }
    if (dismissing && start) {
      const dy = e.clientY - start.y, dt = Date.now() - start.t;
      bg.style.transition = 'opacity 220ms ease';
      if (dy > 140 || (dy > 50 && dy / Math.max(1, dt) > 0.6)) { close(); return; }
      bg.style.opacity = '1';
      tx = 0; ty = 0; apply(true);
      // Toque corto (sin mover): doble toque para acercar
      if (Math.abs(dy) < 8 && dt < 250) {
        const now = Date.now();
        if (now - lastTap < 300) { zoomAt(e.clientX, e.clientY); lastTap = 0; } else lastTap = now;
      }
    } else {
      const now = Date.now();
      if (start && Math.abs(e.clientX - start.x) < 8 && Math.abs(e.clientY - start.y) < 8 && now - start.t < 250) {
        if (now - lastTap < 300) { zoomAt(e.clientX, e.clientY); lastTap = 0; return; }
        lastTap = now;
      }
      settle();
    }
    start = null;
  };
  function zoomAt(x, y) {
    hapticFeedback([8]);
    if (scale > 1.01) { scale = 1; tx = 0; ty = 0; } else {
      const cx = x - innerWidth / 2, cy = y - innerHeight / 2;
      scale = DOUBLE_TAP_SCALE;
      tx = -cx * (DOUBLE_TAP_SCALE - 1);
      ty = -cy * (DOUBLE_TAP_SCALE - 1);
      const { mx, my } = bounds();
      tx = clamp(tx, -mx * (DOUBLE_TAP_SCALE / Math.max(scale, 1)), mx * (DOUBLE_TAP_SCALE / Math.max(scale, 1)));
      ty = clamp(ty, -my * (DOUBLE_TAP_SCALE / Math.max(scale, 1)), my * (DOUBLE_TAP_SCALE / Math.max(scale, 1)));
    }
    apply(true);
    setTimeout(settle, 270);
  }
  img.addEventListener('pointerdown', onDown);
  img.addEventListener('pointermove', onMove);
  img.addEventListener('pointerup', onUp);
  img.addEventListener('pointercancel', onUp);
  // Rueda del ratón en la web
  img.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = clamp(scale * (e.deltaY < 0 ? 1.15 : 0.87), 1, MAX_SCALE);
    if (scale === 1) { tx = 0; ty = 0; }
    apply(true);
  }, { passive: false });
  root.querySelector('.img-viewer__stage').addEventListener('click', (e) => { if (e.target === e.currentTarget && scale <= 1.01) close(); });

  root.querySelector('[data-close]').addEventListener('click', close);
  root.querySelector('[data-download]').addEventListener('click', () => downloadImage(img.currentSrc || src, fileName || title));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  // Botón Atrás de Android: cierra el visor
  const prevBack = window.__androidBack;
  window.__androidBack = () => { close(); return 'handled'; };

  function close() {
    if (!open) return;
    open = null;
    document.removeEventListener('keydown', onKey);
    window.__androidBack = prevBack;
    if (root.__restoreBars) root.__restoreBars();
    root.classList.add('is-closing');
    setTimeout(() => root.remove(), reduced() ? 0 : 220);
  }

  // App Android: barra de estado negra mientras se ve la imagen
  const immersive = (on) => { try { window.AndroidNet?.setImmersive?.(on); } catch (_) {} };
  const wasImmersive = document.body.classList.contains('is-immersive');
  immersive(true);
  root.addEventListener('transitionend', () => {}, { once: true });
  const restoreBars = () => immersive(wasImmersive);
  root.__restoreBars = restoreBars;

  requestAnimationFrame(() => root.classList.add('is-open'));
  open = root;
}

// Descarga: en la app Android se guarda en la galería; en iPhone se abre "Guardar imagen";
// en el navegador se descarga como archivo
export async function downloadImage(src, name = '') {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const base = (name || 'imagen').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'imagen';
    const fileName = `${base}_${Date.now()}.${ext}`;

    if (window.AndroidNet && typeof window.AndroidNet.saveImage === 'function') {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const out = window.AndroidNet.saveImage(dataUrl, fileName);
      if (out === 'ok') { hapticFeedback([12]); showToast('Imagen guardada en la galería (Asistencia)', 'success'); }
      else if (out === 'version') showToast('Tu versión de Android no permite guardar desde la app', 'warning');
      else showToast('No se pudo guardar la imagen', 'danger');
      return;
    }

    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] }); // iPhone: "Guardar imagen"
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('Imagen descargada', 'success');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // canceló el menú de compartir
    showToast('No se pudo descargar la imagen', 'danger');
  }
}

// Cualquier imagen marcada con data-zoom (comunicados, avisos) abre el visor al tocarla
export function initImageViewer() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('img[data-zoom]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openImageViewer(el.currentSrc || el.src, { title: el.dataset.zoomTitle || el.alt || '' });
  }, true);
}
