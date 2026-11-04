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
  // Celulares con poca memoria, pocos núcleos o «ahorro de datos»: la mitad de copos y menos bombillas.
  const LITE = (() => { try { return (navigator.deviceMemory || 8) <= 3 || (navigator.hardwareConcurrency || 8) <= 4 || Boolean(navigator.connection?.saveData); } catch { return false; } })();
  const qty = (n) => Math.max(1, Math.round(LITE ? n * 0.5 : n));
  const lights = (n) => Math.max(6, Math.round(LITE ? n * 0.75 : n));

  // ── Piezas gráficas ──────────────────────────────────────────────────────────
  const BULBS = [['#ff6b5e', '#a3241b'], ['#ffd166', '#b07d12'], ['#6fd39a', '#23774a'], ['#6cb8ff', '#1f5d9e'], ['#ff9ecb', '#a8406f']];
  const rand = (min, max) => min + Math.random() * (max - min);
  const bulb = (i, style) => {
    const [c, d] = BULBS[i % BULBS.length];
    return `<i class="ideas-bulb" style="--c:${c};--d:${d};${style}"></i>`;
  };
  // Las bombillas se reparten en 4 fases, como un controlador real de luces: cada fase se enciende
  // y se mece como un grupo (4 animaciones por guirnalda en vez de dos por bombilla).
  const phases = (items) => [0, 1, 2, 3].map((k) => `<span class="ideas-bulbs ideas-bulbs--${k}">${items.filter((_, i) => i % 4 === k).join('')}</span>`).join('');
  // Guirnalda con caída suave entre puntos de sujeción; las bombillas cuelgan del cable.
  function garland({ bulbs = 14, sag = 7, segments = 4, height = 16, cls = '' } = {}) {
    const y = (x) => 1.5 + sag * Math.sin(Math.PI * ((x % (100 / segments)) / (100 / segments)));
    let d = '';
    for (let x = 0; x <= 100; x += 1) d += `${x ? 'L' : 'M'}${x} ${y(x).toFixed(2)}`;
    const items = [];
    for (let i = 0; i < bulbs; i++) {
      const x = (i + 0.5) * (100 / bulbs);
      const slope = (y(x + 0.5) - y(x - 0.5)) * 2.2;
      items.push(bulb(i, `left:${x.toFixed(2)}%;top:${(y(x) - 0.5).toFixed(2)}px;--rot:${Math.max(-28, Math.min(28, slope * 6)).toFixed(1)}deg`));
    }
    const lights = phases(items);
    return `<span class="ideas-garland ${cls}" ${DECOR} aria-hidden="true" style="--gh:${height}px"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>${lights}</span>`;
  }
  const flake = '<svg viewBox="0 0 20 20"><path d="M10 1v18M2.2 5.5l15.6 9M2.2 14.5l15.6-9M10 4 8 2M10 4l2-2M10 16l-2 2M10 16l2 2"/></svg>';
  // Tres planos: los copos cercanos son más grandes, opacos y rápidos; los lejanos, pequeños y lentos.
  function snow(count, fall) {
    let out = '';
    count = qty(count);
    for (let i = 0; i < count; i++) {
      const depth = i % 3; // 0 lejos · 1 medio · 2 cerca
      const size = rand([2.5, 3.5, 5][depth], [3.5, 5, 8.5][depth]);
      const shape = depth === 2 && i % 2 === 0 ? flake : '';
      const dur = rand([11, 8.5, 6.5][depth], [14, 10.5, 8][depth]);
      const sway = rand(5, 15) * (Math.random() < 0.5 ? -1 : 1);
      out += `<i class="ideas-flake${shape ? ' ideas-flake--star' : ''}" style="left:${rand(0, 100).toFixed(1)}%;--s:${size.toFixed(1)}px;--dur:${dur.toFixed(1)}s;--delay:${rand(-dur, 0).toFixed(1)}s;--fall:${fall}px;--o:${[0.45, 0.65, 0.9][depth]};--sway:${sway.toFixed(0)}px${shape ? `;--sd:${rand(2.4, 4.2).toFixed(1)}s` : ''}"><b>${shape}</b></i>`;
    }
    return out;
  }
  // Destello de cuatro puntas (estrellas del cielo y brillos).
  function glints(count, cls, area) {
    let out = '';
    for (let i = 0; i < count; i++) out += `<i class="ideas-glint ${cls}" style="left:${rand(area[0], area[1]).toFixed(1)}%;top:${rand(area[2], area[3]).toFixed(1)}%;--g:${rand(4, 9).toFixed(1)}px;--gd:${rand(2.2, 4.6).toFixed(1)}s;--gl:${rand(-4.6, 0).toFixed(1)}s"></i>`;
    return out;
  }
  // Momento del día en Lima: el cielo de la escena es de día, de atardecer o de noche.
  function skyMoment() {
    let hour = new Date().getHours();
    try { hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', hourCycle: 'h23' }).format(new Date())); } catch {}
    return hour >= 6 && hour < 17 ? 'dia' : hour >= 17 && hour < 19 ? 'tarde' : 'noche';
  }
  // Cuenta regresiva en hora de Lima (24 y 25 de diciembre, Año Nuevo y Reyes tienen su propio mensaje).
  function countdown() {
    let y, m, d;
    try { [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number); }
    catch { const t = new Date(); [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()]; }
    const day = (Y, M, D) => Math.round(Date.UTC(Y, M - 1, D) / 864e5), today = day(y, m, d);
    if (m === 12 && d === 24) return '¡Hoy es Nochebuena!';
    if (m === 12 && d === 25) return '¡Feliz Navidad!';
    if (m === 12 && d > 25) { const n = day(y + 1, 1, 1) - today; return n === 1 ? '¡Mañana es Año Nuevo!' : `Faltan ${n} días para Año Nuevo`; }
    if (m === 1 && d <= 6) return '¡Feliz Año Nuevo!';
    const n = day(y, 12, 25) - today;
    return n === 1 ? '¡Mañana es Navidad!' : `Faltan ${n} días para Navidad`;
  }
  // Árbol con vida: se mece desde el tronco (grupo interior, así no choca con la posición del SVG),
  // tiene luces que corren por la guirnalda y, de vez en cuando, se le cae nieve de las ramas.
  const TREE_LIGHTS = [[13, 23.6], [16.5, 24.9], [20.5, 25], [24.5, 23.9], [27.5, 22], [9, 38.6], [13.5, 40.4], [18.5, 41.3], [23.5, 41.1], [28.5, 39.7], [31.5, 37.8]];
  // Las piezas animadas se arman por capas: cada parte que se mueve es un SVG o elemento propio.
  // Animar partes DENTRO de un SVG obliga a repintarlo entero en cada cuadro; una capa propia la mueve la GPU.
  const layer = (cls, inner, vb = '0 0 40 56') => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true">${inner}</svg>`;
  const TREE_BASE = `<path d="M17 45h6v9h-6z" fill="#7a5235"/><path d="M17 45h3v9h-3z" fill="#946645"/>
    <path d="M20 17 38 45H2Z" fill="#2f8a5c"/><path d="M20 17 38 45H20Z" fill="#246b48"/>
    <path d="M20 7 34 31H6Z" fill="#37996a"/><path d="M20 7 34 31H20Z" fill="#2a7a53"/>
    <path d="M14 22l3-5M24 37l4-6M10 40l3-4" stroke="#3fae78" stroke-width=".8" stroke-linecap="round" opacity=".7"/>
    <path d="M6 31q14 5 28 0M2 45q18 6 36 0" fill="none" stroke="#f4f8fb" stroke-width="2.4" stroke-linecap="round" opacity=".92"/>
    <path d="M11 22q9 5 18-1M7 37q13 6 26-1" fill="none" stroke="#f2c14e" stroke-width="1.1" stroke-dasharray="1.6 1.4"/>
    <circle cx="13" cy="28" r="1.9" fill="#ff6b5e"/><circle cx="26" cy="27" r="1.7" fill="#6cb8ff"/><circle cx="11" cy="43" r="2" fill="#ffd166"/><circle cx="21" cy="33" r="1.8" fill="#ff9ecb"/><circle cx="30" cy="43" r="1.9" fill="#ff6b5e"/>
    <g fill="#fff" opacity=".9"><circle cx="13.6" cy="27.3" r=".55"/><circle cx="26.5" cy="26.4" r=".5"/><circle cx="11.6" cy="42.3" r=".55"/><circle cx="21.6" cy="32.4" r=".5"/><circle cx="30.6" cy="42.3" r=".55"/></g>`;
  const TREE_STAR = '<path d="M20 .8l1.9 3.9 4.3.6-3.1 3 .7 4.3L20 10.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="#ffd166"/><path d="M20 2.6l1 2.2 2.2.3" fill="none" stroke="#fff6cf" stroke-width=".7" stroke-linecap="round"/>';
  const tree = (cls = '') => {
    const flip = cls.includes('ideas-tree--flip');
    const g = (inner) => flip ? `<g transform="matrix(-1 0 0 1 40 0)">${inner}</g>` : inner;
    const group = (odd) => TREE_LIGHTS.filter((_, i) => i % 2 === (odd ? 1 : 0)).map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.05" fill="${BULBS[(i * 2 + (odd ? 1 : 0)) % BULBS.length][0]}"/>`).join('');
    const [dx, dy] = Math.random() < 0.5 ? [6.5, 31.5] : [34, 45.5];
    return `<span class="ideas-tree ${cls}" aria-hidden="true" style="--td:${rand(-6, 0).toFixed(1)}s">` +
      layer('ideas-tree-base', g(TREE_BASE)) + layer('ideas-tree-lights', g(group(false))) + layer('ideas-tree-lights ideas-tree-lights--b', g(group(true))) +
      '<i class="ideas-tree-halo"></i>' + layer('ideas-tree-star', TREE_STAR) +
      `<i class="ideas-tree-drop" style="left:${((flip ? 40 - dx : dx) / 40 * 100).toFixed(1)}%;top:${(dy / 56 * 100).toFixed(1)}%;animation-delay:${rand(-9, 0).toFixed(1)}s"></i></span>`;
  };
  const gift = (a, b, ribbon, cls = '') => `<svg class="ideas-gift ${cls}" viewBox="0 0 20 18" aria-hidden="true" style="--hop:${rand(-7, 0).toFixed(1)}s"><rect x="1.5" y="6.5" width="17" height="11" rx="1.5" fill="${a}"/><rect x="10" y="6.5" width="8.5" height="11" rx="1.5" fill="${b}"/><rect x=".5" y="3.8" width="19" height="4" rx="1.2" fill="${a}"/><rect x="8.6" y="3.8" width="2.8" height="13.7" fill="${ribbon}"/><path d="M10 3.8C7 0 3.5 1.6 6.3 3.8M10 3.8c3-3.8 6.5-2.2 3.7 0" fill="none" stroke="${ribbon}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const SM_BODY = '<ellipse cx="20" cy="43" rx="15" ry="12" fill="#f3f8fb" stroke="#9db7c6"/><path d="M8 47q12 8 24 0" fill="none" stroke="#d7e6ee" stroke-width="3"/><path d="M27 36q5 3 6 9" fill="none" stroke="#dbe8ef" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="20" cy="40" r="1.3" fill="#304d53"/><circle cx="20" cy="45" r="1.3" fill="#304d53"/><circle cx="20" cy="50" r="1.3" fill="#304d53"/><path d="m7 39-5-8m2.4 3.8-2.6.6" stroke="#8d7664" stroke-width="2" stroke-linecap="round"/>';
  const SM_HEAD = '<circle cx="20" cy="25" r="10" fill="#fbfdfe" stroke="#9db7c6"/><circle cx="14.6" cy="27.4" r="1.8" fill="#f4a3a3" opacity=".55"/><circle cx="25.4" cy="27.4" r="1.8" fill="#f4a3a3" opacity=".55"/>' +
    '<path d="m20 25.6 8 2-8 2" fill="#e08a3a"/><path d="M16 29.4q4 2.6 8 0" fill="none" stroke="#304d53" stroke-width=".9" stroke-linecap="round" stroke-dasharray=".1 1.6"/>';
  const SM_EYES = '<circle cx="17" cy="23.6" r="1.2" fill="#304d53"/><circle cx="23" cy="23.6" r="1.2" fill="#304d53"/><circle cx="17.4" cy="23.2" r=".35" fill="#fff"/><circle cx="23.4" cy="23.2" r=".35" fill="#fff"/>';
  const SM_HAT = '<path d="M10 17h21" stroke="#304d53" stroke-width="3" stroke-linecap="round"/><path d="M14 16V7h13v9Z" fill="#304d53"/><path d="M14 13.5h13" stroke="#c9483f" stroke-width="2"/><circle cx="24.5" cy="13.5" r="1.4" fill="#2f8a5c"/><circle cx="25.6" cy="12.6" r=".7" fill="#d9363e"/>';
  const SM_SCARF = '<path d="M12 32h16l-4 5-12-2" fill="#c9483f"/><path d="M14 33.5h12" stroke="#ffd166" stroke-width="1" stroke-dasharray="1.5 1.5"/>';
  const SM_TAIL = '<path d="M23 34.5l2.5 9.5 3.4-1-2.2-8.8Z" fill="#b8352f"/><path d="M24.5 39.5l3-.8M25.4 42.4l2.6-.7" stroke="#ffd166" stroke-width=".9"/>';
  const snowman = '<span class="ideas-snowman" aria-hidden="true"><span class="sm-breathe">' + layer('sm-part', SM_BODY) +
    layer('sm-part sm-arm', '<path d="m33 39 5-8m-2.4 3.8 2.6.6" stroke="#8d7664" stroke-width="2" stroke-linecap="round"/>') +
    '<span class="sm-head">' + layer('sm-part', SM_HEAD) + layer('sm-part sm-eyes', SM_EYES) + layer('sm-part sm-hat', SM_HAT) + '</span>' +
    layer('sm-part', SM_SCARF) + layer('sm-part sm-scarf', SM_TAIL) + layer('sm-part sm-breath', '<circle cx="29" cy="27" r="1.6" fill="#fff"/><circle cx="31.5" cy="25" r="1.2" fill="#fff"/>') + '</span></span>';
  // Trineo con dos renos genéricos (dibujo propio).
  const reindeer = (x) => `<g transform="translate(${x} 0)"><path d="M2 12q1-5 8-5 4 0 6 2l3-4 1 1-2 4q1 2-1 3-2 1-7 1-6 0-8-2Z" fill="#9a6a44"/><path d="M5 13q4 2 10 0" stroke="#c99b70" stroke-width="1.4" fill="none"/><path d="M19 5l-1-3m1 3 2-2m-2 2-3-2" stroke="#6e4a2e" stroke-width=".9" stroke-linecap="round"/><circle cx="20.6" cy="8.4" r=".9" fill="#3a2a20"/></g>`;
  const legs = (x, cls) => layer('ideas-sleigh-legs ' + cls, `<path transform="translate(${x} 0)" d="M5 13l-2 5M8 13l1 5M13 13l-1 5M15 12l3 5" stroke="#6e4a2e" stroke-width="1.2" stroke-linecap="round"/>`, '0 0 96 24');
  const sleigh = `<svg class="ideas-sleigh-art" viewBox="0 0 96 24" aria-hidden="true"><path d="M30 13c10 0 16-1 22-3M50 11c10-1 14-2 20-3" stroke="#f2c14e" stroke-width=".8" fill="none"/>${reindeer(48)}${reindeer(70)}<path d="M4 9q-2 7 6 8h20q4 0 5-5l1-4H12q-4 0-4 3" fill="#c9372f"/><path d="M10 10h22" stroke="#ffd166" stroke-width="1"/><path d="M2 20h30q4 0 5-3" stroke="#ffd166" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M8 17v3M28 17v3" stroke="#ffd166" stroke-width="1.2"/><path d="M14 8q-1-7 6-7t7 6Z" fill="#2f8a5c"/><rect x="21" y="2" width="5" height="5" rx="1" fill="#6cb8ff"/><path d="M23.5 2v5" stroke="#fff" stroke-width=".8"/></svg>`;
  const cabin = `<svg class="ideas-cabin" viewBox="0 0 44 38" aria-hidden="true"><path d="M31 6h5v12h-5z" fill="#6e4a2e"/><path d="M30 4h7v3h-7z" fill="#f4f8fb"/><path d="M5 20h34v17H5z" fill="#8a5a3b"/><path d="M5 24h34M5 28h34M5 32h34" stroke="#6e4a2e" stroke-width=".8"/><path d="M1 21 22 6l21 15Z" fill="#7a3b2c"/><path d="M0 22 22 5.5 44 22l-2.5 1.5L22 9 2.5 23.5Z" fill="#f4f8fb"/><rect x="10" y="24" width="8" height="7" rx="1" fill="#ffd27a"/><path d="M14 24v7M10 27.5h8" stroke="#8a5a3b" stroke-width=".9"/><rect x="25" y="25" width="7" height="12" rx="1" fill="#5a3b26"/><circle cx="30.5" cy="31" r=".7" fill="#ffd166"/><path d="M3 37h38" stroke="#f4f8fb" stroke-width="2" stroke-linecap="round"/></svg>`;
  const cane = (cls) => `<svg class="ideas-cane ${cls}" viewBox="0 0 12 26" aria-hidden="true"><path d="M3 25V7a4 4 0 0 1 8 0" fill="none" stroke="#fdfdfd" stroke-width="3.2" stroke-linecap="round"/><path d="M3 25V7a4 4 0 0 1 8 0" fill="none" stroke="#d9363e" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="2.2 2.4"/></svg>`;
  const bell = `<span class="ideas-bell" ${DECOR} aria-hidden="true"><svg viewBox="0 0 16 18"><path d="M8 1.5v1.8" stroke="#b07d12" stroke-width="1.4" stroke-linecap="round"/><path d="M3 13c1-1 1-3 1-5a4 4 0 0 1 8 0c0 2 0 4 1 5Z" fill="#f2c14e"/><path d="M5.2 8a2.8 2.8 0 0 1 2.2-2.7" stroke="#fff3c4" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M2.5 13h11" stroke="#b07d12" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="15" r="1.6" fill="#b07d12"/><path d="M5 2.6 8 4l3-1.4" stroke="#d9363e" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></span>`;
  // Esfera que cuelga en la esquina libre de las tarjetas de estadísticas.
  const tileOrnament = (i) => {
    const [c, d] = BULBS[i % BULBS.length];
    return `<span class="ideas-tile-orn" ${DECOR} aria-hidden="true" style="animation-delay:${(i * -0.8).toFixed(1)}s"><svg viewBox="0 0 16 30"><path d="M8 0v11" stroke="#b9a37a" stroke-width=".8"/><rect x="5.6" y="10" width="4.8" height="3.4" rx="1" fill="#c9a94f"/><circle cx="8" cy="20" r="6.6" fill="${d}"/><circle cx="8" cy="20" r="6" fill="${c}"/><path d="M2.4 18.6q5.6 2.4 11.2 0M2.4 21.6q5.6 2.4 11.2 0" fill="none" stroke="#fff" stroke-width=".9" opacity=".6"/><ellipse cx="5.8" cy="17.4" rx="1.6" ry="2.2" fill="#fff" opacity=".7"/></svg></span>`;
  };
  // Íconos pequeños que acompañan a los títulos de sección (en línea, después del texto).
  const HEADER_ICONS = [
    ['ball', '<svg viewBox="0 0 14 16"><path d="M7 0v3.2" stroke="#b9a37a" stroke-width=".8"/><rect x="5" y="2.6" width="4" height="2.6" rx=".8" fill="#c9a94f"/><circle cx="7" cy="10" r="5.2" fill="#d9363e"/><path d="M2.2 9.2q4.8 2 9.6 0" stroke="#ffd166" stroke-width="1" fill="none"/><ellipse cx="5.2" cy="8" rx="1.2" ry="1.7" fill="#fff" opacity=".7"/></svg>'],
    ['star', '<svg viewBox="0 0 16 16"><path d="M8 .8l2 4.4 4.8.5-3.6 3.3 1 4.8L8 11.4l-4.2 2.4 1-4.8L1.2 5.7 6 5.2Z" fill="#f2c14e"/><path d="M8 3.4 9.2 6l2.6.3" fill="none" stroke="#fff3c4" stroke-width=".8" stroke-linecap="round"/></svg>'],
    ['cane', '<svg viewBox="0 0 12 18"><path d="M3 17V6a3.4 3.4 0 0 1 6.8 0" fill="none" stroke="#fdfdfd" stroke-width="2.8" stroke-linecap="round"/><path d="M3 17V6a3.4 3.4 0 0 1 6.8 0" fill="none" stroke="#d9363e" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="1.8 2"/></svg>'],
    ['gift', '<svg viewBox="0 0 16 16"><rect x="1.5" y="6" width="13" height="9" rx="1.2" fill="#3f86c9"/><rect x="1" y="4" width="14" height="3.4" rx="1" fill="#5aa0dd"/><rect x="6.8" y="4" width="2.4" height="11" fill="#ffd166"/><path d="M8 4C5.6 1 3 2.3 5 4M8 4c2.4-3 5-1.7 3 0" fill="none" stroke="#ffd166" stroke-width="1.2" stroke-linecap="round"/></svg>'],
    ['bell', '<svg viewBox="0 0 16 18"><path d="M3 13c1-1 1-3 1-5a4 4 0 0 1 8 0c0 2 0 4 1 5Z" fill="#f2c14e"/><path d="M2.5 13h11" stroke="#b07d12" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="15" r="1.6" fill="#b07d12"/><path d="M5 2.6 8 4l3-1.4" stroke="#2f8a5c" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>'],
    ['flake', '<svg viewBox="0 0 20 20"><path d="M10 1v18M2.2 5.5l15.6 9M2.2 14.5l15.6-9M10 4 8 2M10 4l2-2M10 16l-2 2M10 16l2 2" fill="none" stroke="#5aa9e6" stroke-width="1.8" stroke-linecap="round"/></svg>'],
  ];
  const headerIcon = (i) => { const [kind, svg] = HEADER_ICONS[i % HEADER_ICONS.length]; return `<span class="ideas-head-icon ideas-head-icon--${kind}" ${DECOR} aria-hidden="true">${svg}</span>`; };
  const lamp = '<svg class="ideas-lamp" viewBox="0 0 22 60" aria-hidden="true"><path d="M10 20h2v38h-2z" fill="#2f3b45"/><path d="M7 57h8v3H7z" fill="#2f3b45"/><path d="M5 9h12l-2 10H7Z" fill="#3a4a55"/><rect x="7.6" y="11" width="6.8" height="7" rx="1" fill="#ffd98a"/><path d="M4 9h14l-7-5Z" fill="#2f3b45"/><path d="M3.5 9.4q7.5-3 15 0" stroke="#f4f8fb" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="11" cy="32" r="4.2" fill="none" stroke="#2f8a5c" stroke-width="2.4"/><circle cx="9" cy="29.6" r=".9" fill="#d9363e"/><circle cx="13.6" cy="31" r=".9" fill="#d9363e"/><path d="M11 35.4l-2.4 3m2.4-3 2.4 3" stroke="#d9363e" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const penguin = '<svg class="ideas-penguin-art" viewBox="0 0 22 26" aria-hidden="true"><ellipse cx="11" cy="15" rx="7.4" ry="9" fill="#26323a"/><ellipse cx="11.8" cy="16.4" rx="4.8" ry="6.8" fill="#f7fafc"/><circle cx="11" cy="7.2" r="5.4" fill="#26323a"/><ellipse cx="12.4" cy="8.2" rx="3.4" ry="3" fill="#f7fafc"/><circle cx="13.2" cy="7.2" r=".9" fill="#26323a"/><path d="M15.4 8.4l3 1-3 .9Z" fill="#f2a43a"/><path d="M6 11.6h10" stroke="#d9363e" stroke-width="2.2" stroke-linecap="round"/><path d="M7 12.2l-1.2 4.2 2.4-.4Z" fill="#d9363e"/><path d="M7 24h4M12 24h4" stroke="#f2a43a" stroke-width="2" stroke-linecap="round"/><path d="M7.5 2.4q3.5-3.4 7 0" fill="#d9363e"/><circle cx="11" cy=".9" r="1.2" fill="#fff"/></svg>';
  const titleFlake = `<span class="ideas-title-flake" ${DECOR} aria-hidden="true">${flake}</span>`;
  const noteFlake = `<span class="ideas-note-flake" ${DECOR} aria-hidden="true">${flake}</span>`;
  const holly = `<span class="ideas-holly" ${DECOR} aria-hidden="true"><svg viewBox="0 0 24 16"><path d="M12 9C9 3 4 4 1 6c3 0 3 3 6 2-1 2 1 4 5 1Z" fill="#2f8a5c"/><path d="M12 9c3-6 8-5 11-3-3 0-3 3-6 2 1 2-1 4-5 1Z" fill="#246b48"/><g><circle cx="10.5" cy="9.5" r="2.2" fill="#d94b45"/><circle cx="13.5" cy="9.5" r="2.2" fill="#e85d55"/><circle cx="12" cy="7" r="2.2" fill="#c9372f"/></g><circle cx="11.6" cy="6.3" r=".6" fill="#fff" opacity=".7"/></svg></span>`;

  // ── Colocación en espacios reservados ───────────────────────────────────────
  function decorateHero(hero) {
    setClass(hero, 'ideas-hero-decorated');
    if (hero.querySelector(':scope > .ideas-hero-decor')) return;
    const layer = document.createElement('span');
    layer.className = 'ideas-hero-decor';
    layer.setAttribute(DECOR, '');
    layer.setAttribute('aria-hidden', 'true');
    // La guirnalda vive en el relleno superior (20 px) y la nieve, detrás del texto.
    layer.innerHTML = garland({ bulbs: lights(innerWidth < 380 ? 11 : 14), sag: 5, segments: 4, height: 12, cls: 'ideas-garland--hero' }) + `<span class="ideas-hero-snow">${snow(innerWidth < 380 ? 7 : 9, 190)}${glints(4, 'ideas-glint--hero', [62, 96, 18, 82])}</span>` + '<span class="ideas-hero-drift"></span>';
    hero.prepend(layer);
  }
  function decorateProfile(head, measure = false) {
    const target = head.querySelector(':scope > .avatar-edit, :scope > .avatar');
    if (!target) return;
    setClass(head, 'ideas-avatar-decorated');
    let layer = head.querySelector(':scope > .ideas-avatar-decor');
    if (layer && !measure) return;
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'ideas-avatar-decor';
      layer.setAttribute(DECOR, '');
      layer.setAttribute('aria-hidden', 'true');
      // Aro de luces detrás de la foto, con un hueco abajo a la derecha para el botón de cámara.
      const ringItems = [];
      const count = 14;
      for (let i = 0; i < count; i++) {
        const angle = -150 + i * (255 / (count - 1));
        const rad = angle * Math.PI / 180;
        ringItems.push(bulb(i, `left:calc(50% + ${Math.sin(rad).toFixed(4)} * var(--rr));top:calc(50% - ${Math.cos(rad).toFixed(4)} * var(--rr));--rot:${(angle + 180).toFixed(0)}deg`));
      }
      const ring = phases(ringItems);
      layer.innerHTML = `<span class="ideas-avatar-ring"><svg viewBox="0 0 100 100"><path d="M${(50 + 46 * Math.sin(-160 * Math.PI / 180)).toFixed(2)} ${(50 - 46 * Math.cos(-160 * Math.PI / 180)).toFixed(2)}A46 46 0 1 1 ${(50 + 46 * Math.sin(115 * Math.PI / 180)).toFixed(2)} ${(50 - 46 * Math.cos(115 * Math.PI / 180)).toFixed(2)}"/></svg>${ring}<span class="ideas-avatar-bow"><svg viewBox="0 0 24 14"><path d="M12 7C8 1 2 1 2 5s6 5 10 2Zm0 0c4-6 10-6 10-2s-6 5-10 2Z" fill="#d94b45"/><path d="m11 8-4 6 3-1 1 2Zm2 0 4 6-3-1-1 2Z" fill="#b8352f"/><circle cx="12" cy="7" r="2" fill="#f06a60"/></svg></span><span class="ideas-avatar-orbit"><i></i><i></i></span></span>` +
        `<span class="ideas-avatar-side ideas-avatar-side--left"><span class="ideas-side-snow">${snow(4, 96)}</span>${tree()}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--small')}</span>` +
        `<span class="ideas-avatar-side ideas-avatar-side--right"><span class="ideas-side-snow">${snow(4, 96)}</span>${gift('#3f86c9', '#2d6aa3', '#f4f8fb', 'ideas-gift--small')}${tree('ideas-tree--flip')}</span>`;
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
    // Capas de atrás hacia adelante: cielo (aurora, estrellas, luna, estrella fugaz), trineo,
    // colinas, cabaña y adornos, nieve, textos. El texto y la cuenta regresiva quedan siempre encima.
    scene.innerHTML = '<span class="ideas-aurora"><i></i><i></i></span><span class="ideas-clouds"><span><i></i></span><span><i></i></span><span><i></i></span></span>' + glints(qty(8), 'ideas-glint--sky', [4, 96, 8, 52]) +
      '<span class="ideas-scene-moon"></span><span class="ideas-shooting"><i></i></span>' +
      `<span class="ideas-sleigh"><span class="ideas-sleigh-bob"><span class="ideas-stardust"><i></i><i></i><i></i><i></i></span>${sleigh}${legs(48, 'ideas-sleigh-legs--a')}${legs(70, 'ideas-sleigh-legs--b')}</span></span>` +
      '<span class="ideas-scene-hill ideas-scene-hill--back"></span><span class="ideas-scene-hill ideas-scene-hill--front"></span>' +
      `<span class="ideas-scene-props">${cabin}<i class="ideas-cabin-glow"></i><span class="ideas-smoke"><i></i><i></i><i></i></span>${tree('ideas-tree--a')}${tree('ideas-tree--b')}${cane('ideas-cane--a')}${cane('ideas-cane--b')}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--a')}${gift('#3f86c9', '#2d6aa3', '#f4f8fb', 'ideas-gift--b')}${gift('#37996a', '#2a7a53', '#ff9ecb', 'ideas-gift--c')}${tree('ideas-tree--c')}${snowman}</span>` +
      `<span class="ideas-scene-snow">${snow(16, 180)}</span>` +
      garland({ bulbs: lights(innerWidth < 380 ? 12 : 16), sag: 8, segments: 5, height: 16, cls: 'ideas-garland--scene' }) +
      `<div class="ideas-scene-text"><strong>¡Felices fiestas!</strong><span>Instituto IDEAS te desea una feliz Navidad</span><em class="ideas-countdown">${countdown()}</em></div>`;
    setClass(scene, 'ideas-scene--' + skyMoment());
    const note = page.querySelector(':scope > .sa-sync-note');
    if (note) note.before(scene); else page.append(scene);
  }
  function decorate() {
    document.querySelectorAll('.hero').forEach(decorateHero);
    document.querySelectorAll('.profile-head').forEach(decorateProfile);
    document.querySelectorAll('.page').forEach((page) => { if (page.querySelector(':scope > .hero')) decorateHome(page); });
    document.querySelectorAll('.view .large-title__kicker').forEach((kicker) => {
      if (kicker.closest('.view')?.querySelector('.hero') && !kicker.querySelector('.ideas-holly')) kicker.insertAdjacentHTML('beforeend', holly + bell);
    });
    // Escarcha en el borde superior de las tarjetas (pseudoelementos: no cambia su estructura).
    // Solo cae sobre el relleno superior vacío; el destello se ubica distinto en cada tarjeta.
    let cardIndex = 0;
    document.querySelectorAll('.view .ios-card').forEach((card) => {
      if (card.closest('[data-ideas-decor],.staff-skeleton,.sheet,.action-sheet,dialog,[role="dialog"]')) return;
      setClass(card, 'ideas-frost');
      for (let v = 1; v <= 3; v++) setClass(card, 'ideas-frost--' + v, v === cardIndex % 3 + 1);
      const fx = ((cardIndex * 37) % 60 + 25) + '%';
      if (card.style.getPropertyValue('--ideas-fx') !== fx) card.style.setProperty('--ideas-fx', fx);
      cardIndex++;
    });
    // Esferas que cuelgan en la esquina libre de las tarjetas de estadísticas.
    document.querySelectorAll('.view .stat-tile').forEach((tile, i) => {
      if (!tile.querySelector(':scope > .ideas-tile-orn') && !tile.closest('.staff-skeleton')) tile.insertAdjacentHTML('beforeend', tileOrnament(i));
    });
    // Íconos junto a los títulos de sección que solo tienen texto.
    document.querySelectorAll('.view').forEach((view) => {
      view.querySelectorAll('.section-head__title, .list-header').forEach((title, i) => {
        if (title.querySelector('.ideas-head-icon') || [...title.children].some((child) => !child.hasAttribute(DECOR)) || !title.textContent.trim()) return;
        title.insertAdjacentHTML('beforeend', headerIcon(i));
      });
    });
    // Pie nevado (sección nueva al final) en las pantallas sin escena navideña.
    document.querySelectorAll('.view .view__content > .page').forEach((page) => {
      if (page.querySelector(':scope > .hero, :scope > .ideas-page-footer') || page.closest('.staff-skeleton') || page.querySelector('.staff-skeleton,.login')) return;
      page.insertAdjacentHTML('beforeend', `<div class="ideas-page-footer" ${DECOR} aria-hidden="true"><span class="ideas-scene-snow">${snow(6, 76)}</span><span class="ideas-lamp-glow"></span>${lamp}<span class="ideas-footer-drift"></span><span class="ideas-penguin"><span class="ideas-penguin-turn"><span class="ideas-penguin-face"><span class="ideas-penguin-waddle">${penguin}${layer('ideas-penguin-wing', '<path d="M4.2 13q-3 4-1 8 2.4-1 2.6-4.4Z" fill="#1c262d"/>', '0 0 22 26')}</span></span></span></span>${tree('ideas-tree--f1')}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--f')}${tree('ideas-tree--f2')}</div>`);
    });
    // Copo que gira junto al título «Modo Navidad» (alumnos, personal y trabajadores).
    document.querySelectorAll('[data-ideas-season-toggle], #toggle-temporada').forEach((input) => {
      const title = input.closest('.list-row')?.querySelector('.list-row__main > span:first-child');
      if (title && !title.querySelector('.ideas-title-flake')) title.insertAdjacentHTML('beforeend', titleFlake);
    });
    // Copitos en la nota inferior de cada pantalla.
    document.querySelectorAll('.sa-sync-note').forEach((note) => {
      if (!note.querySelector('.ideas-note-flake')) { note.insertAdjacentHTML('afterbegin', noteFlake); note.insertAdjacentHTML('beforeend', noteFlake); }
    });
    // Paisaje nevado al pie del login (bloque propio debajo de todo).
    document.querySelectorAll('.login').forEach((login) => {
      if (!login.querySelector(':scope > .ideas-login-scene')) login.insertAdjacentHTML('beforeend', `<div class="ideas-login-scene" ${DECOR} aria-hidden="true"><span class="ideas-scene-snow">${snow(8, 70)}</span><span class="ideas-login-hill"></span>${tree('ideas-tree--l1')}${tree('ideas-tree--l2')}${gift('#d94b45', '#b8352f', '#ffd166', 'ideas-gift--l')}${snowman}${tree('ideas-tree--l3')}</div>`);
    });
    document.querySelectorAll('.brand-lockup').forEach((lockup) => {
      if (!lockup.previousElementSibling?.matches('.ideas-garland--login')) lockup.insertAdjacentHTML('beforebegin', garland({ bulbs: 9, sag: 6, segments: 3, height: 14, cls: 'ideas-garland--login' }));
    });
    if (adminWeb()) document.querySelectorAll('.sidebar-brand').forEach((brand) => {
      if (!brand.querySelector(':scope > .ideas-garland--admin')) brand.insertAdjacentHTML('beforeend', garland({ bulbs: 10, sag: 5, segments: 3, height: 12, cls: 'ideas-garland--admin' }));
    });
  }
  // Las animaciones fuera de la pantalla se pausan (ahorra batería y mantiene fluido el desplazamiento).
  const visibility = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((entry) => setClass(entry.target, 'ideas-offscreen', !entry.isIntersecting)), { rootMargin: '60px' }) : null;
  const watched = new WeakSet();
  function watchVisibility() {
    if (!visibility) return;
    document.querySelectorAll('.ideas-xmas-scene,.ideas-hero-decor,.ideas-avatar-decor,.ideas-login-scene,.ideas-page-footer,.ideas-tile-orn,.ideas-head-icon').forEach((el) => { if (!watched.has(el)) { watched.add(el); visibility.observe(el); } });
  }
  function undecorate() {
    document.querySelectorAll(`[${DECOR}]`).forEach((el) => el.remove());
    document.querySelectorAll('.ideas-frost').forEach((el) => { el.classList.remove('ideas-frost', 'ideas-frost--1', 'ideas-frost--2', 'ideas-frost--3'); el.style.removeProperty('--ideas-fx'); });
    document.querySelectorAll('.ideas-avatar-decorated,.ideas-hero-decorated').forEach((el) => el.classList.remove('ideas-avatar-decorated', 'ideas-avatar-decorated--square', 'ideas-hero-decorated'));
  }
  const observed = new WeakSet();
  const resizer = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    if (!enabled()) return;
    requestAnimationFrame(() => entries.forEach((entry) => entry.target.isConnected && decorateProfile(entry.target, true)));
  }) : null;

  // ── Vida: programas de luces y ráfagas de viento ─────────────────────────────
  // Se guardan en atributos data-* del documento que el observador no escucha (no provocan repintados).
  const LIGHT_MODES = ['cadena', 'destello', 'alterno', 'respira'];
  let modeIndex = 0, modeTimer = null, windTimer = null, windOff = null;
  function setRootData(name, value) { const root = document.documentElement; if (value == null) { if (root.hasAttribute(name)) root.removeAttribute(name); } else if (root.getAttribute(name) !== value) root.setAttribute(name, value); }
  function scheduleLife() {
    const alive = enabled() && !document.hidden && !reduced();
    if (!alive) { clearInterval(modeTimer); clearTimeout(windTimer); clearTimeout(windOff); modeTimer = windTimer = null; setRootData('data-ideas-luces', null); setRootData('data-ideas-viento', null); return; }
    if (!modeTimer) {
      setRootData('data-ideas-luces', LIGHT_MODES[modeIndex]);
      modeTimer = setInterval(() => { modeIndex = (modeIndex + 1) % LIGHT_MODES.length; setRootData('data-ideas-luces', LIGHT_MODES[modeIndex]); }, 10000);
    }
    if (!windTimer) {
      const gust = () => {
        setRootData('data-ideas-viento', '1');
        windOff = setTimeout(() => setRootData('data-ideas-viento', null), 2800);
        windTimer = setTimeout(gust, rand(15000, 26000));
      };
      windTimer = setTimeout(gust, rand(6000, 12000));
    }
  }
  // Tocar la escena: los árboles se sacuden, los regalos saltan, el muñeco saluda,
  // las luces destellan, cae una ráfaga de nieve y suenan campanitas (si la música no está apagada).
  function jingle() {
    if (read('ideas-navidad-musica') === 'off') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      ctx.resume().then(() => {
        const t0 = ctx.currentTime + 0.02;
        [88, 91, 95, 100, 95].forEach((midi, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.09;
          o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.65);
        });
        setTimeout(() => ctx.close().catch(() => {}), 1400);
      }).catch(() => ctx.close().catch(() => {}));
    } catch {}
  }
  function celebrate(scene) {
    if (scene.classList.contains('ideas-celebrate')) return;
    setClass(scene, 'ideas-celebrate');
    const layer = scene.querySelector('.ideas-scene-snow');
    if (layer && !reduced()) {
      const burst = document.createElement('span');
      burst.className = 'ideas-burst';
      burst.innerHTML = snow(16, 180);
      layer.append(burst);
      setTimeout(() => burst.remove(), 2600);
    }
    jingle();
    setTimeout(() => setClass(scene, 'ideas-celebrate', false), 2300);
  }
  document.addEventListener('click', (event) => {
    const scene = event.target.closest?.('.ideas-xmas-scene');
    if (scene) celebrate(scene);
  });

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
    if (active) { decorate(); watchVisibility(); } else undecorate();
    scheduleLife();
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
    if (event.target.matches('[data-ideas-season-toggle], #toggle-temporada')) {
      if (event.target.matches('[data-ideas-season-toggle]')) save('ideas-temporada', event.target.checked ? 'on' : 'off');
      if (event.target.checked) { setRootData('data-ideas-entrada', '1'); setTimeout(() => setRootData('data-ideas-entrada', null), 1100); }
      window.dispatchEvent(new Event('ideas:temporada'));
    }
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
    const root = document.documentElement, body = document.body;
    if (records.every((r) => ours(r.target) || (r.type === 'attributes' && r.target !== root && r.target !== body) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(ours)))) return;
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-temporada', 'data-movimiento'] });
  update();
})();
