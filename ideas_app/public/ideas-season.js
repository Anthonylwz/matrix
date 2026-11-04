/*
 * Modo Navidad de IDEAS (app de alumnos, personal, trabajadores y panel web).
 *
 * Regla de diseño: ninguna decoración se dibuja encima del contenido. Todo se coloca
 * en espacios reservados para ella:
 *   - dentro del fondo de la tarjeta de bienvenida (.hero), detrás del texto;
 *   - alrededor de la foto de perfil, con margen propio que se reserva al activarse;
 *   - una tarjeta-escena propia al final de la pantalla «Hoy» (ocupa su espacio);
 *   - adornos en línea (acebo junto a la fecha, guirnalda sobre el logo del login).
 * No hay capas fijas sobre la pantalla, así que no tapa botones, barras ni menús.
 * La música se genera con osciladores (sin grabaciones ni melodías de terceros).
 */
(() => {
  'use strict';
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const DECOR = 'data-ideas-decor';
  // classList.add/toggle registran una mutación aunque no cambie nada; esto evita un bucle con el observador.
  const setClass = (el, name, on = true) => { if (el.classList.contains(name) !== Boolean(on)) el.classList.toggle(name, Boolean(on)); };
  const enabled = () => document.documentElement.dataset.temporada !== 'off' && read('ideas-temporada') !== 'off' && read('ideas-temporada-global') !== 'off';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.movimiento === 'reducido';
  const app = () => Boolean(document.getElementById('app-view'));
  const adminWeb = () => document.body.classList.contains('admin-body');
  // Sesión abierta: no depende de la pestaña visible (antes, al ir a «Alumnos» se consideraba
  // cerrada y la música volvía a sonar al regresar a «Hoy»).
  const signedIn = () => adminWeb() || (app() && !document.getElementById('login-form') && !/login/.test(location.hash) &&
    (document.body.classList.contains('student-mode') || (!document.body.classList.contains('no-bottom-nav') && Boolean(read('asistencia_user')) && read('asistencia_bloqueada') !== '1')));
  const blocked = () => document.hidden || document.body.classList.contains('is-immersive');

  // ── Piezas gráficas ──────────────────────────────────────────────────────────
  const BULBS = [['#ff6b5e', '#a3241b'], ['#ffd166', '#b07d12'], ['#6fd39a', '#23774a'], ['#6cb8ff', '#1f5d9e'], ['#ff9ecb', '#a8406f']];
  const rand = (min, max) => min + Math.random() * (max - min);
  const bulb = (i, style) => {
    const [c, d] = BULBS[i % BULBS.length];
    return `<i class="ideas-bulb" style="--c:${c};--d:${d};--tw:${(i % 4) * -0.9}s;${style}"></i>`;
  };
  // Guirnalda con caída suave entre puntos de sujeción; las bombillas cuelgan del cable.
  function garland({ bulbs = 14, sag = 7, segments = 4, height = 16, cls = '' } = {}) {
    const y = (x) => 1.5 + sag * Math.sin(Math.PI * ((x % (100 / segments)) / (100 / segments)));
    let d = '';
    for (let x = 0; x <= 100; x += 1) d += `${x ? 'L' : 'M'}${x} ${y(x).toFixed(2)}`;
    let lights = '';
    for (let i = 0; i < bulbs; i++) {
      const x = (i + 0.5) * (100 / bulbs);
      const slope = (y(x + 0.5) - y(x - 0.5)) * 2.2;
      lights += bulb(i, `left:${x.toFixed(2)}%;top:${(y(x) - 0.5).toFixed(2)}px;--rot:${Math.max(-28, Math.min(28, slope * 6)).toFixed(1)}deg`);
    }
    return `<span class="ideas-garland ${cls}" ${DECOR} aria-hidden="true" style="--gh:${height}px"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>${lights}</span>`;
  }
  const flake = '<svg viewBox="0 0 20 20"><path d="M10 1v18M2.2 5.5l15.6 9M2.2 14.5l15.6-9M10 4 8 2M10 4l2-2M10 16l-2 2M10 16l2 2"/></svg>';
  function snow(count, fall) {
    let out = '';
    for (let i = 0; i < count; i++) {
      const size = rand(3, i % 3 === 0 ? 9 : 5).toFixed(1);
      const shape = i % 3 === 0 ? flake : '';
      out += `<i class="ideas-flake${shape ? ' ideas-flake--star' : ''}" style="left:${rand(0, 100).toFixed(1)}%;--s:${size}px;--dur:${rand(6, 11).toFixed(1)}s;--delay:${rand(-11, 0).toFixed(1)}s;--dx:${rand(-18, 18).toFixed(0)}px;--fall:${fall}px;--o:${rand(0.45, 0.9).toFixed(2)}">${shape}</i>`;
    }
    return out;
  }
  const tree = (cls = '') => `<svg class="ideas-tree ${cls}" viewBox="0 0 40 56" aria-hidden="true">
    <path d="M17 45h6v9h-6z" fill="#7a5235"/><path d="M17 45h3v9h-3z" fill="#946645"/>
    <path d="M20 17 38 45H2Z" fill="#2f8a5c"/><path d="M20 17 38 45H20Z" fill="#246b48"/>
    <path d="M20 7 34 31H6Z" fill="#37996a"/><path d="M20 7 34 31H20Z" fill="#2a7a53"/>
    <path d="M6 31q14 5 28 0M2 45q18 6 36 0" fill="none" stroke="#f4f8fb" stroke-width="2.4" stroke-linecap="round" opacity=".92"/>
    <path d="M11 22q9 5 18-1M7 37q13 6 26-1" fill="none" stroke="#f2c14e" stroke-width="1.1" stroke-dasharray="1.6 1.4"/>
    <circle class="ideas-orn" cx="13" cy="26" r="1.9" fill="#ff6b5e"/><circle class="ideas-orn" cx="25" cy="21" r="1.7" fill="#6cb8ff"/>
    <circle class="ideas-orn" cx="11" cy="40" r="2" fill="#ffd166"/><circle class="ideas-orn" cx="21" cy="36" r="1.8" fill="#ff9ecb"/>
    <circle class="ideas-orn" cx="30" cy="41" r="1.9" fill="#ff6b5e"/>
    <path class="ideas-tree-star" d="M20 .8l1.9 3.9 4.3.6-3.1 3 .7 4.3L20 10.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#ffd166"/>
  </svg>`;
  const gift = (a, b, ribbon, cls = '') => `<svg class="ideas-gift ${cls}" viewBox="0 0 20 18" aria-hidden="true"><rect x="1.5" y="6.5" width="17" height="11" rx="1.5" fill="${a}"/><rect x="10" y="6.5" width="8.5" height="11" rx="1.5" fill="${b}"/><rect x=".5" y="3.8" width="19" height="4" rx="1.2" fill="${a}"/><rect x="8.6" y="3.8" width="2.8" height="13.7" fill="${ribbon}"/><path d="M10 3.8C7 0 3.5 1.6 6.3 3.8M10 3.8c3-3.8 6.5-2.2 3.7 0" fill="none" stroke="${ribbon}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const snowman = '<svg class="ideas-snowman" viewBox="0 0 40 56" aria-hidden="true"><ellipse cx="20" cy="43" rx="15" ry="12" fill="#f3f8fb" stroke="#9db7c6"/><path d="M8 47q12 8 24 0" fill="none" stroke="#d7e6ee" stroke-width="3"/><g class="ideas-snowman-head"><circle cx="20" cy="25" r="10" fill="#fbfdfe" stroke="#9db7c6"/><path d="M10 17h21M14 16V7h13v9" fill="#304d53" stroke="#304d53" stroke-width="3"/><path d="M14 13.5h13" stroke="#c9483f" stroke-width="2"/><path d="M12 32h16l-4 5-12-2" fill="#c9483f"/><path d="M14 33.5h12" stroke="#ffd166" stroke-width="1" stroke-dasharray="1.5 1.5"/><g class="ideas-snowman-eyes"><circle cx="17" cy="24" r="1.2"/><circle cx="23" cy="24" r="1.2"/></g><path d="m20 26 8 2-8 2" fill="#e08a3a"/></g><circle cx="20" cy="41" r="1.3"/><circle cx="20" cy="47" r="1.3"/><path d="m7 39-5-8" stroke="#8d7664" stroke-width="2"/><path class="ideas-snowman-wave" d="m33 39 5-8" stroke="#8d7664" stroke-width="2"/></svg>';
  const holly = `<span class="ideas-holly" ${DECOR} aria-hidden="true"><svg viewBox="0 0 24 16"><path d="M12 9C9 3 4 4 1 6c3 0 3 3 6 2-1 2 1 4 5 1Z" fill="#2f8a5c"/><path d="M12 9c3-6 8-5 11-3-3 0-3 3-6 2 1 2-1 4-5 1Z" fill="#246b48"/><circle class="ideas-orn" cx="10.5" cy="9.5" r="2.2" fill="#d94b45"/><circle class="ideas-orn" cx="13.5" cy="9.5" r="2.2" fill="#e85d55"/><circle class="ideas-orn" cx="12" cy="7" r="2.2" fill="#c9372f"/></svg></span>`;

  // ── Colocación en espacios reservados ───────────────────────────────────────
  function decorateHero(hero) {
    setClass(hero, 'ideas-hero-decorated');
    if (hero.querySelector(':scope > .ideas-hero-decor')) return;
    const layer = document.createElement('span');
    layer.className = 'ideas-hero-decor';
    layer.setAttribute(DECOR, '');
    layer.setAttribute('aria-hidden', 'true');
    // La guirnalda vive en el relleno superior (20 px) y la nieve, detrás del texto.
    layer.innerHTML = garland({ bulbs: innerWidth < 380 ? 11 : 14, sag: 5, segments: 4, height: 12, cls: 'ideas-garland--hero' }) + `<span class="ideas-hero-snow">${snow(innerWidth < 380 ? 8 : 12, 190)}</span>` + '<span class="ideas-hero-drift"></span>';
    hero.prepend(layer);
  }
  function decorateProfile(head) {
    const target = head.querySelector(':scope > .avatar-edit, :scope > .avatar');
    if (!target) return;
    setClass(head, 'ideas-avatar-decorated');
    let layer = head.querySelector(':scope > .ideas-avatar-decor');
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'ideas-avatar-decor';
      layer.setAttribute(DECOR, '');
      layer.setAttribute('aria-hidden', 'true');
      // Aro de luces detrás de la foto, con un hueco abajo a la derecha para el botón de cámara.
      let ring = '';
      const count = 14;
      for (let i = 0; i < count; i++) {
        const angle = -150 + i * (255 / (count - 1));
        const rad = angle * Math.PI / 180;
        ring += bulb(i, `left:calc(50% + ${Math.sin(rad).toFixed(4)} * var(--rr));top:calc(50% - ${Math.cos(rad).toFixed(4)} * var(--rr));--rot:${(angle + 180).toFixed(0)}deg`);
      }
      layer.innerHTML = `<span class="ideas-avatar-ring"><svg viewBox="0 0 100 100"><path d="M${(50 + 46 * Math.sin(-160 * Math.PI / 180)).toFixed(2)} ${(50 - 46 * Math.cos(-160 * Math.PI / 180)).toFixed(2)}A46 46 0 1 1 ${(50 + 46 * Math.sin(115 * Math.PI / 180)).toFixed(2)} ${(50 - 46 * Math.cos(115 * Math.PI / 180)).toFixed(2)}"/></svg>${ring}<span class="ideas-avatar-bow"><svg viewBox="0 0 24 14"><path d="M12 7C8 1 2 1 2 5s6 5 10 2Zm0 0c4-6 10-6 10-2s-6 5-10 2Z" fill="#d94b45"/><path d="m11 8-4 6 3-1 1 2Zm2 0 4 6-3-1-1 2Z" fill="#b8352f"/><circle cx="12" cy="7" r="2" fill="#f06a60"/></svg></span></span>` +
        `<span class="ideas-avatar-side ideas-avatar-side--left">${tree()}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--small')}</span>` +
        `<span class="ideas-avatar-side ideas-avatar-side--right">${gift('#3f86c9', '#2d6aa3', '#f4f8fb', 'ideas-gift--small')}${tree('ideas-tree--flip')}</span>`;
      head.prepend(layer);
    }
    // Posición calculada a partir de la foto real (no tapa el nombre: se reserva margen en CSS).
    const box = { left: target.offsetLeft, top: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight };
    if (!box.w) return;
    const style = layer.style;
    for (const [name, value] of [['--ax', box.left], ['--ay', box.top], ['--aw', box.w], ['--ah', box.h]]) if (style.getPropertyValue(name) !== value + 'px') style.setProperty(name, value + 'px');
    // Si no hay sitio a los lados (pantallas muy angostas), los árboles se ocultan.
    // Foto cuadrada con esquinas redondeadas: el aro se abre un poco más para no rozar las esquinas.
    const face = target.matches('.avatar') ? target : target.querySelector('.avatar') || target;
    const square = parseFloat(getComputedStyle(face).borderTopLeftRadius) < box.w * 0.42;
    setClass(head, 'ideas-avatar-decorated--square', square);
    setClass(layer, 'ideas-avatar-decor--square', square);
    setClass(layer, 'ideas-avatar-decor--narrow', box.left < 94 || head.clientWidth - (box.left + box.w) < 94);
    if (!observed.has(head) && 'ResizeObserver' in window) { observed.add(head); resizer.observe(head); }
  }
  function decorateHome(page) {
    if (page.querySelector(':scope > .ideas-xmas-scene')) return;
    const scene = document.createElement('section');
    scene.className = 'ideas-xmas-scene';
    scene.setAttribute(DECOR, '');
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML = garland({ bulbs: innerWidth < 380 ? 12 : 16, sag: 8, segments: 5, height: 16, cls: 'ideas-garland--scene' }) +
      '<span class="ideas-scene-moon"></span>' + snow(18, 150) +
      '<div class="ideas-scene-text"><strong>¡Felices fiestas!</strong><span>Instituto IDEAS te desea una feliz Navidad</span></div>' +
      '<span class="ideas-scene-hill ideas-scene-hill--back"></span><span class="ideas-scene-hill ideas-scene-hill--front"></span>' +
      `<span class="ideas-scene-props">${tree('ideas-tree--a')}${tree('ideas-tree--b')}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--a')}${gift('#3f86c9', '#2d6aa3', '#f4f8fb', 'ideas-gift--b')}${gift('#37996a', '#2a7a53', '#ff9ecb', 'ideas-gift--c')}${tree('ideas-tree--c')}${snowman}</span>`;
    const note = page.querySelector(':scope > .sa-sync-note');
    if (note) note.before(scene); else page.append(scene);
  }
  function decorate() {
    document.querySelectorAll('.hero').forEach(decorateHero);
    document.querySelectorAll('.profile-head').forEach(decorateProfile);
    document.querySelectorAll('.page').forEach((page) => { if (page.querySelector(':scope > .hero')) decorateHome(page); });
    document.querySelectorAll('.view .large-title__kicker').forEach((kicker) => {
      if (kicker.closest('.view')?.querySelector('.hero') && !kicker.querySelector('.ideas-holly')) kicker.insertAdjacentHTML('beforeend', holly);
    });
    document.querySelectorAll('.brand-lockup').forEach((lockup) => {
      if (!lockup.previousElementSibling?.matches('.ideas-garland--login')) lockup.insertAdjacentHTML('beforebegin', garland({ bulbs: 9, sag: 6, segments: 3, height: 14, cls: 'ideas-garland--login' }));
    });
    if (adminWeb()) document.querySelectorAll('.sidebar-brand').forEach((brand) => {
      if (!brand.querySelector(':scope > .ideas-garland--admin')) brand.insertAdjacentHTML('beforeend', garland({ bulbs: 10, sag: 5, segments: 3, height: 12, cls: 'ideas-garland--admin' }));
    });
  }
  function undecorate() {
    document.querySelectorAll(`[${DECOR}]`).forEach((el) => el.remove());
    document.querySelectorAll('.ideas-avatar-decorated,.ideas-hero-decorated').forEach((el) => el.classList.remove('ideas-avatar-decorated', 'ideas-avatar-decorated--square', 'ideas-hero-decorated'));
  }
  const observed = new WeakSet();
  const resizer = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    if (!enabled()) return;
    requestAnimationFrame(() => entries.forEach((entry) => entry.target.isConnected && decorateProfile(entry.target)));
  }) : null;

  // ── Música (osciladores, 16 s, una vez por sesión) ───────────────────────────
  let context, played = false, wasSignedIn = false;
  try {
    if (document.querySelector('.login-card,.login__card')) sessionStorage.removeItem('ideas-christmas-played');
    played = sessionStorage.getItem('ideas-christmas-played') === '1';
  } catch {}
  function stopMusic() { if (context) { context.close().catch(() => {}); context = null; } }
  function play() {
    if (context || !enabled() || blocked() || !signedIn() || read('ideas-navidad-musica') === 'off') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      context = new Ctx();
      const current = context;
      current.resume().then(() => {
        if (current !== context) return;
        if (current.state !== 'running') { stopMusic(); return; }
        played = true;
        try { sessionStorage.setItem('ideas-christmas-played', '1'); } catch {}
        const start = current.currentTime + 0.08, beat = 0.44;
        // Armonía original de jazz suave; no contiene grabaciones ni melodías de terceros.
        const chords = [[48, 52, 55, 59], [45, 48, 52, 55], [50, 53, 57, 60], [43, 47, 50, 53], [48, 52, 55, 59], [53, 57, 60, 64], [50, 53, 57, 60], [43, 47, 50, 53]];
        const note = (midi, t, length, volume) => {
          const o = current.createOscillator(), g = current.createGain();
          o.type = 'sine'; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(volume, t + 0.025); g.gain.exponentialRampToValueAtTime(0.0001, t + length);
          o.connect(g); g.connect(current.destination); o.start(t); o.stop(t + length + 0.02);
        };
        chords.forEach((chord, bar) => {
          const t = start + bar * 4 * beat;
          chord.forEach((m, j) => note(m + 12, t + j * 0.025, 1.4, 0.014));
          note(chord[0] - 12, t, 1.1, 0.025);
          [0, 2, 1, 3].forEach((n, j) => note(chord[n] + 24, t + j * beat + (j % 2) * 0.06, 0.5, 0.012));
          // Campanitas suaves al final de cada compás.
          note(chord[3] + 36, t + 3.5 * beat, 0.35, 0.006);
        });
        setTimeout(() => { if (context === current) stopMusic(); }, 16000);
      }).catch(() => { if (context === current) stopMusic(); });
    } catch { stopMusic(); }
  }

  // ── Confirmación de cierre de sesión en el panel web de administración ──────
  function confirmAdminLogout(go) {
    if (typeof HTMLDialogElement !== 'function') { if (confirm('¿Cerrar sesión de administración?')) go(); return; }
    const dialog = document.createElement('dialog');
    dialog.className = 'ideas-logout-dialog';
    dialog.setAttribute('aria-labelledby', 'ideas-logout-title');
    dialog.innerHTML = '<h2 id="ideas-logout-title">¿Cerrar sesión?</h2><p>Se cerrará tu sesión de administración en este navegador. La información guardada no se pierde.</p><div class="ideas-logout-actions"><button type="button" class="ideas-logout-cancel">Cancelar</button><button type="button" class="ideas-logout-confirm">Cerrar sesión</button></div>';
    document.body.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('.ideas-logout-cancel').onclick = close;
    dialog.querySelector('.ideas-logout-confirm').onclick = (event) => { event.target.disabled = true; event.target.textContent = 'Cerrando…'; go(); };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.showModal();
    dialog.querySelector('.ideas-logout-cancel').focus();
  }
  const LOGOUT_URL = /(^|\/)(logout|cerrar_sesion|salir)\.php(\?|#|$)/i;
  // Solo actúa si el panel no trae ya su propia confirmación.
  const ownConfirmation = () => Boolean(document.querySelector('.ideas-logout-dialog:not([open])[id], [data-logout-confirm]'));
  document.addEventListener('click', (event) => {
    if (!adminWeb() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || ownConfirmation()) return;
    const link = event.target.closest('a[href]');
    if (!link || !LOGOUT_URL.test(link.getAttribute('href')) || link.dataset.ideasConfirmed === '1') return;
    event.preventDefault();
    confirmAdminLogout(() => { link.dataset.ideasConfirmed = '1'; location.href = link.href; });
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!adminWeb() || event.defaultPrevented || ownConfirmation() || !LOGOUT_URL.test(form.getAttribute('action') || '') || form.dataset.ideasConfirmed === '1') return;
    event.preventDefault();
    confirmAdminLogout(() => { form.dataset.ideasConfirmed = '1'; form.submit(); });
  });

  // ── Ciclo de vida ───────────────────────────────────────────────────────────
  function update() {
    if (!document.body) return;
    const sync = (input, checked, disabled) => { if (checked !== null && input.checked !== checked) input.checked = checked; if (input.disabled !== disabled) input.disabled = disabled; };
    document.querySelectorAll('[data-ideas-season-toggle]').forEach((input) => sync(input, enabled(), read('ideas-temporada-global') === 'off'));
    document.querySelectorAll('[data-ideas-christmas-music]').forEach((input) => sync(input, read('ideas-navidad-musica') !== 'off', !enabled()));
    document.querySelectorAll('[data-ideas-christmas-play]').forEach((input) => sync(input, null, !enabled()));
    setClass(document.documentElement, 'ideas-christmas-still', reduced());
    const active = enabled();
    if (active) decorate(); else undecorate();
    const now = signedIn();
    if (!now && wasSignedIn) { played = false; try { sessionStorage.removeItem('ideas-christmas-played'); } catch {} stopMusic(); }
    wasSignedIn = now;
    if (!active || blocked()) stopMusic();
    else if (now && !played) play();
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-ideas-christmas-play]')) { save('ideas-navidad-musica', 'on'); played = false; stopMusic(); play(); update(); }
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-ideas-christmas-music]')) {
      save('ideas-navidad-musica', event.target.checked ? 'on' : 'off');
      if (!event.target.checked) stopMusic(); else { played = false; play(); }
      update();
      return;
    }
    if (event.target.matches('[data-ideas-season-toggle]')) { save('ideas-temporada', event.target.checked ? 'on' : 'off'); window.dispatchEvent(new Event('ideas:temporada')); }
  });
  // El navegador exige un gesto antes de sonar: el primer toque dentro de la sesión lo inicia.
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-ideas-christmas-play],[data-ideas-christmas-music]')) return;
    if (context?.state === 'suspended') context.resume().catch(stopMusic); else if (!played) play();
  }, { passive: true });
  window.addEventListener('ideas:temporada', update);
  window.addEventListener('storage', update);
  window.addEventListener('hashchange', update);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', stopMusic);
  window.addEventListener('pageshow', update);
  // Las apps vuelven a dibujar sus pantallas: se reponen los adornos sin reaccionar a los propios.
  const ours = (node) => node.nodeType !== 1 || node.hasAttribute?.(DECOR) || Boolean(node.closest?.(`[${DECOR}]`));
  let queued = false;
  new MutationObserver((records) => {
    if (records.every((r) => ours(r.target) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(ours)))) return;
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-temporada', 'data-movimiento'] });
  update();
})();
