// Prueba de conexión: mide desde este celular cuánto tarda el servidor en responder, con Wi-Fi o con
// datos móviles, para comparar ambas redes con cifras reales.
// Solo consulta estado_servidor.php: no usa la cuenta, la contraseña ni datos personales. Va por el
// mismo camino que el resto de la app (en el APK, el puente nativo de Android).
import { openSheet, dismissSheet, APP_VERSION } from './utils.js';
import { getServerKey } from './server-context.js';
import { netStats } from './net-retry.js';

const HISTORY = 'ideas-prueba-conexion:v1';
const SEQUENTIAL = 8, PARALLEL = 4, TIMEOUT = 10000, MAX_AGE = 7 * 24 * 3600 * 1000;
const TOTAL = 1 + SEQUENTIAL + PARALLEL;
const NETS = { wifi: 'Wi-Fi', datos: 'Datos móviles' };
const number = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
let active = null;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (value) => `${number.format(Math.round(value))} ms`;
const connection = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

function networkInfo() {
  const c = connection();
  const effective = /^(slow-2g|2g|3g|4g)$/.test(c?.effectiveType || '') ? c.effectiveType.replace('slow-', '').toUpperCase() : '';
  return { type: c?.type || '', effective, online: navigator.onLine !== false };
}

// Android informa el tipo de red activa al WebView; en un navegador puede no estar disponible.
function detectedNet(info) {
  if (info.type === 'wifi' || info.type === 'ethernet') return 'wifi';
  if (info.type === 'cellular') return 'datos';
  return '';
}

function serverHost() {
  try { return new URL(getServerKey()).host; } catch (_) { return ''; }
}

function statusUrl() {
  return new URL(`${String(window.APP_API_URL || '../api/').replace(/\/$/, '')}/estado_servidor.php`, location.href).href;
}

function pause(time, signal) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, time);
    signal.addEventListener('abort', done, { once: true });
  });
}

// Una consulta: tiempo hasta tener la respuesta completa, o el motivo del fallo.
async function probe(signal) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, TIMEOUT);
  const start = performance.now();
  try {
    const response = await fetch(statusUrl(), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'manual', signal: controller.signal });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    const time = performance.now() - start;
    // El APK no sigue redirecciones y entrega el 3xx; el navegador, con redirect manual, una respuesta opaca.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return { time, error: 'la red redirige la consulta (¿Wi-Fi con página de acceso?)' };
    if (!response.ok) return { time, error: `el servidor respondió ${response.status}` };
    if (!data || typeof data !== 'object') return { time, error: 'la respuesta no es del servidor de IDEAS' };
    if (data.success !== true && data.success !== 1) return { time, error: data.message || data.mensaje || 'el servidor informó un problema' };
    return { time };
  } catch (error) {
    if (signal.aborted) throw error;
    return { time: performance.now() - start, error: controller.signal.aborted ? 'tardó más de 10 s' : 'sin conexión con el servidor' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(first, sequential, parallel, parallelTime, net, info) {
  const all = [first, ...sequential, ...parallel];
  const ok = sequential.filter((r) => !r.error).map((r) => r.time).sort((a, b) => a - b);
  const errors = {};
  all.filter((r) => r.error).forEach((r) => { errors[r.error] = (errors[r.error] || 0) + 1; });
  const round = (value) => (value == null ? null : Math.round(value));
  return {
    at: Date.now(), net, type: info.type, effective: info.effective, server: serverHost(), version: APP_VERSION,
    apk: Boolean(window.AndroidNet),
    first: first.error ? null : round(first.time),
    median: round(median(ok)), min: round(ok[0]), max: round(ok[ok.length - 1]),
    parallel: parallel.every((r) => r.error) ? null : round(parallelTime),
    fails: all.filter((r) => r.error).length, total: all.length, errors,
    recovered: netStats.recovered
  };
}

function verdict(run) {
  if (run.median == null) return { tone: 'danger', label: 'Sin conexión', text: 'El servidor no respondió desde esta red.' };
  const cuts = run.fails ? ' · con cortes' : '';
  if (run.fails >= 3) return { tone: 'danger', label: 'Inestable', text: 'Varias consultas fallaron: la señal o la red cortan la conexión.' };
  if (run.median <= 500) return { tone: run.fails ? 'warning' : 'success', label: 'Buena' + cuts, text: 'La app debería sentirse rápida con esta red.' };
  if (run.median <= 1200) return { tone: run.fails ? 'warning' : 'info', label: 'Aceptable' + cuts, text: 'Funciona bien; algunas pantallas pueden tardar un poco en actualizarse.' };
  if (run.median <= 3000) return { tone: 'warning', label: 'Lenta' + cuts, text: 'Cada consulta tarda: busca mejor señal o prueba con la otra red.' };
  return { tone: 'danger', label: 'Muy lenta' + cuts, text: 'La app tardará en cargar y en marcar con esta red.' };
}

function notes(run) {
  const list = [];
  if (run.first != null && run.median != null && run.first - run.median > 400) {
    list.push(`La primera consulta tardó ${ms(run.first - run.median)} más: es el tiempo de abrir la conexión segura. Es normal y suele notarse más con datos móviles.`);
  }
  if (run.parallel != null && run.median != null && run.parallel > run.median * 2.5 && run.parallel - run.median > 600) {
    list.push('Las consultas simultáneas se atendieron casi una por una: el servidor o la red las ponen en fila.');
  }
  Object.entries(run.errors).forEach(([reason, count]) => list.push(`${count} ${count === 1 ? 'consulta falló' : 'consultas fallaron'}: ${reason}.`));
  if (run.recovered) list.push(`Desde que abriste la app, ${run.recovered} ${run.recovered === 1 ? 'consulta se recuperó' : 'consultas se recuperaron'} sola${run.recovered === 1 ? '' : 's'} tras un corte de red.`);
  return list;
}

function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && NETS[r.net] && Number.isFinite(r.at) && Date.now() - r.at < MAX_AGE) : [];
  } catch (_) { return []; }
}

function saveRun(run) {
  try { localStorage.setItem(HISTORY, JSON.stringify([run, ...readHistory()].slice(0, 8))); } catch (_) {}
}

function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

// effectiveType es la calidad que estima Android, no el tipo de antena: solo va en el texto copiado.
function netLabel(run, detailed = false) {
  return NETS[run.net] + (detailed && run.net === 'datos' && run.effective ? ` (calidad ${run.effective})` : '');
}

// Último resultado de cada red para el mismo servidor.
function comparison(run) {
  const latest = {};
  [run, ...readHistory()].forEach((r) => { if (r.server === run.server && !latest[r.net]) latest[r.net] = r; });
  if (!latest.wifi || !latest.datos) return { latest, text: '' };
  const wifi = latest.wifi.median, datos = latest.datos.median;
  let text;
  if (wifi == null && datos == null) text = 'El servidor no respondió con ninguna de las dos redes.';
  else if (wifi == null) text = 'Con Wi-Fi el servidor no respondió; con datos móviles sí.';
  else if (datos == null) text = 'Con datos móviles el servidor no respondió; con Wi-Fi sí.';
  else if (Math.max(wifi, datos) / Math.max(1, Math.min(wifi, datos)) < 1.3) text = 'Las dos redes responden parecido.';
  else {
    const slower = datos > wifi ? 'datos móviles' : 'Wi-Fi', faster = datos > wifi ? 'Wi-Fi' : 'datos móviles';
    text = `Con ${slower} el servidor responde ${number.format(Math.max(wifi, datos) / Math.max(1, Math.min(wifi, datos)))} veces más lento que con ${faster}.`;
  }
  return { latest, text };
}

function resultText(run) {
  const when = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(run.at);
  const v = verdict(run);
  const lines = [
    `Prueba de conexión IDEAS v${run.version}${run.apk ? ' (APK)' : ' (web)'}`,
    `${when} · ${netLabel(run, true)}${run.server ? ' · ' + run.server : ''}`,
    `Resultado: ${v.label}`,
    `Respuesta típica: ${run.median == null ? 'sin respuesta' : ms(run.median)}`,
    `Primera consulta: ${run.first == null ? 'falló' : ms(run.first)}`,
    `Más rápida / más lenta: ${run.min == null ? '—' : `${ms(run.min)} / ${ms(run.max)}`}`,
    `${PARALLEL} a la vez: ${run.parallel == null ? 'fallaron' : ms(run.parallel)}`,
    `Fallos: ${run.fails} de ${run.total}`
  ];
  notes(run).forEach((note) => lines.push('- ' + note));
  const { latest, text } = comparison(run);
  if (text) {
    lines.push('', 'Comparación:');
    ['wifi', 'datos'].forEach((net) => { const r = latest[net]; lines.push(`${netLabel(r, true)}: ${r.median == null ? 'sin respuesta' : ms(r.median)} · ${r.fails} fallos · ${ago(r.at)}`); });
    lines.push(text);
  }
  return lines.join('\n');
}

const kv = (label, value) => `<div class="kv-row"><span class="kv-row__label">${esc(label)}</span><span class="kv-row__value">${esc(value)}</span></div>`;

function resultMarkup(run) {
  const v = verdict(run);
  const list = notes(run);
  return `<div class="ios-card net-test__card">
    <div class="net-test__head"><span class="ios-badge badge-${v.tone}">${esc(v.label)}</span><span class="net-test__net">${esc(netLabel(run))}</span></div>
    <p class="net-test__summary">${esc(v.text)}</p>
    ${kv('Respuesta típica', run.median == null ? 'Sin respuesta' : ms(run.median))}
    ${kv('Primera consulta', run.first == null ? 'Falló' : ms(run.first))}
    ${kv('Más rápida / más lenta', run.min == null ? '—' : `${ms(run.min)} / ${ms(run.max)}`)}
    ${kv(`${PARALLEL} consultas a la vez`, run.parallel == null ? 'Fallaron' : ms(run.parallel))}
    ${kv('Fallos', `${run.fails} de ${run.total}`)}
    ${list.length ? `<ul class="net-test__notes">${list.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function compareMarkup(run) {
  const { latest, text } = comparison(run);
  if (!text) {
    const other = run.net === 'wifi' ? 'Ahora apaga el Wi-Fi y repite la prueba solo con datos móviles para comparar.' : 'Ahora conéctate a un Wi-Fi y repite la prueba para comparar.';
    return `<p class="sheet-hint net-test__next">${esc(other)}</p>`;
  }
  return `<div class="list-header">Comparación en este celular</div><div class="ios-card net-test__card">
    ${['wifi', 'datos'].map((net) => { const r = latest[net]; return kv(`${netLabel(r)} · ${ago(r.at)}`, `${r.median == null ? 'Sin respuesta' : ms(r.median)} · ${r.fails} ${r.fails === 1 ? 'fallo' : 'fallos'}`); }).join('')}
    <p class="net-test__summary net-test__summary--end">${esc(text)}</p>
  </div>`;
}

function markup() {
  return `<div class="sheet-backdrop" id="net-test-sheet" hidden><div class="sheet net-test" role="dialog" aria-modal="true" aria-labelledby="net-test-title" tabindex="-1">
    <div class="sheet__grabber"></div>
    <div class="sheet__nav"><button type="button" class="nav-btn nav-btn--text" data-net-close>Cerrar</button><h3 class="sheet__nav-title" id="net-test-title">Probar conexión</h3><span></span></div>
    <p class="sheet-hint">Mide cuánto tarda el servidor en responder desde este celular. No usa tu cuenta ni envía datos personales. Hazla una vez con Wi-Fi y otra con el Wi-Fi apagado, solo con datos móviles.</p>
    <div class="segmented net-test__nets" role="radiogroup" aria-label="¿Cómo estás conectado ahora?">
      <button type="button" class="segmented__item" role="radio" aria-checked="false" data-net="wifi">Wi-Fi</button>
      <button type="button" class="segmented__item" role="radio" aria-checked="false" data-net="datos">Datos móviles</button>
    </div>
    <p class="sheet-hint net-test__detected" data-net-detected></p>
    <button type="button" class="ios-btn ios-btn-primary" data-net-start>Iniciar prueba</button>
    <div class="net-test__bar" data-net-bar hidden><span></span></div>
    <p class="sheet-hint net-test__status" role="status" aria-live="polite" data-net-status></p>
    <div data-net-result></div>
    <div data-net-compare></div>
    <button type="button" class="ios-btn ios-btn-secondary" data-net-copy hidden>Copiar resultado</button>
  </div></div>`;
}

async function copyText(text, host) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'net-test__clip';
    host.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch (_) { return false; }
}

export function openConnectionTest() {
  if (active) return;
  const holder = document.createElement('div');
  holder.innerHTML = markup();
  const modal = holder.firstElementChild;
  document.body.appendChild(modal);
  const panel = modal.querySelector('.sheet');
  const $ = (selector) => modal.querySelector(selector);
  const start = $('[data-net-start]'), status = $('[data-net-status]'), bar = $('[data-net-bar]'), detected = $('[data-net-detected]');
  const result = $('[data-net-result]'), compare = $('[data-net-compare]'), copy = $('[data-net-copy]');
  const state = { modal, net: '', controller: null, run: null };
  active = state;

  const paintNets = () => {
    modal.querySelectorAll('[data-net]').forEach((item) => {
      const on = item.dataset.net === state.net;
      item.classList.toggle('is-active', on);
      item.setAttribute('aria-checked', String(on));
      item.disabled = Boolean(state.controller);
    });
    start.disabled = !state.net || Boolean(state.controller);
  };
  // La red detectada solo se elige sola al abrir y cuando cambia; la elección manual se respeta.
  const paintDetected = (autoselect = false) => {
    const info = networkInfo(), found = detectedNet(info);
    if (autoselect && !state.controller && found) state.net = found;
    let text = '';
    if (!info.online) text = 'El celular indica que no tiene conexión. Activa el Wi-Fi o los datos móviles.';
    else if (found === 'wifi' && state.net === 'datos') text = 'Android indica que usas Wi-Fi: apágalo para medir solo los datos móviles.';
    else if (found === 'datos' && state.net === 'wifi') text = 'Android indica que usas datos móviles: conéctate a un Wi-Fi para medirlo.';
    else if (found) text = `Android indica: ${found === 'wifi' ? 'Wi-Fi' : 'datos móviles'}${found === 'datos' && info.effective ? ` (calidad ${info.effective})` : ''}.`;
    else text = 'Elige cómo estás conectado ahora.';
    detected.textContent = text;
    paintNets();
  };
  const progress = (done) => {
    bar.firstElementChild.style.transform = `scaleX(${done / TOTAL})`;
    status.textContent = `Consulta ${Math.min(done + 1, TOTAL)} de ${TOTAL}…`;
  };
  const paintRun = (run) => {
    result.innerHTML = resultMarkup(run);
    compare.innerHTML = compareMarkup(run);
    copy.hidden = false;
  };

  async function run() {
    if (state.controller || !state.net) return;
    const controller = new AbortController();
    state.controller = controller;
    const { signal } = controller;
    const info = networkInfo();
    paintNets();
    start.textContent = 'Probando…';
    bar.hidden = false;
    result.innerHTML = compare.innerHTML = '';
    copy.hidden = true;
    let done = 0;
    progress(0);
    const step = (r) => { done++; if (!signal.aborted) progress(done); return r; };
    try {
      const first = step(await probe(signal));
      const sequential = [];
      for (let i = 0; i < SEQUENTIAL; i++) { await pause(150, signal); if (signal.aborted) return; sequential.push(step(await probe(signal))); }
      await pause(150, signal);
      if (signal.aborted) return;
      const t0 = performance.now();
      const parallel = await Promise.all(Array.from({ length: PARALLEL }, () => probe(signal).then(step)));
      const parallelTime = performance.now() - t0;
      if (signal.aborted) return;
      const summary = summarize(first, sequential, parallel, parallelTime, state.net, info);
      saveRun(summary);
      state.run = summary;
      status.textContent = 'Prueba terminada.';
      paintRun(summary);
    } catch (_) {
      // Cancelada al cerrar la hoja.
    } finally {
      if (state.controller === controller) state.controller = null;
      if (active === state) {
        bar.hidden = true;
        start.textContent = state.run ? 'Repetir prueba' : 'Iniciar prueba';
        paintDetected();
      }
    }
  }

  modal.querySelectorAll('[data-net]').forEach((item) => item.addEventListener('click', () => { if (!state.controller) { state.net = item.dataset.net; paintDetected(); } }));
  start.addEventListener('click', run);
  $('[data-net-close]').addEventListener('click', () => dismissSheet(modal));
  copy.addEventListener('click', async () => {
    if (!state.run) return;
    status.textContent = await copyText(resultText(state.run), panel) ? 'Resultado copiado. Puedes pegarlo en un mensaje.' : 'No se pudo copiar; toma una captura de pantalla.';
  });
  const onNetworkChange = () => { if (active === state) paintDetected(true); };
  connection()?.addEventListener?.('change', onNetworkChange);
  window.addEventListener('online', onNetworkChange);
  window.addEventListener('offline', onNetworkChange);

  // Muestra el último resultado guardado (si es reciente) para que se vea la comparación.
  const last = readHistory().find((r) => r.server === serverHost());
  paintDetected(true);
  if (last) { state.run = last; paintRun(last); status.textContent = `Última prueba: ${netLabel(last)}, ${ago(last.at)}.`; }

  openSheet(modal, {
    focus: panel,
    onClose: () => {
      state.controller?.abort();
      connection()?.removeEventListener?.('change', onNetworkChange);
      window.removeEventListener('online', onNetworkChange);
      window.removeEventListener('offline', onNetworkChange);
      modal.remove();
      if (active === state) active = null;
    }
  });
}

// Atrás de Android en las apps de personal y alumnos (el enrutador del trabajador ya cierra cualquier hoja).
export function handleConnectionTestBack() {
  if (!active) return false;
  dismissSheet(active.modal);
  return true;
}
