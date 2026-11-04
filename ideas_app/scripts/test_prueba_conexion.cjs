// Pruebas 4.2.4: «Probar conexión» y reintento de consultas de lectura tras un corte de red.
// Usa un servidor simulado (sin datos reales ni red): no mide la conexión real del celular.
// Requiere Playwright con Chromium. Uso: node scripts/test_prueba_conexion.cjs
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const TOKEN = 'a'.repeat(64);
let BASE, KEY, ORIGIN;
const panel = { identidad: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, permisos: { estudiantes: true, trabajadores: true, asistencia: true }, resumen: { marcaciones_hoy: 18 }, marcaciones: [] };
const student = { alumno: { id: 42, dni: '33333333', nombre: 'Carlos', apellido: 'M' }, matriculas: [], cursos: [], horarios: [], evaluaciones: [], pagos: [], pagos_historial: [], huella: 'h1' };
const worker = (KEY) => ({ tipo: 'trabajador', rol: 'trabajador', server_key: KEY, id: 5, trabajador_id: 5, dni: '11223344', nombre: 'Jorge Salazar', nombres: 'Jorge', apellidos: 'Salazar', codigo_interno: 'T-005', foto_url: '' });

// Sesiones guardadas y red simulada (navigator.connection) antes de que cargue la app.
function seed({ role, KEY, TOKEN, worker, student }) {
  const conn = new EventTarget(); conn.type = 'wifi'; conn.effectiveType = '4g';
  Object.defineProperty(navigator, 'connection', { get: () => conn, configurable: true });
  window.__setNet = (type, effective) => { conn.type = type; conn.effectiveType = effective; conn.dispatchEvent(new Event('change')); };
  if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1);
  localStorage.clear(); localStorage.setItem('ideas-navidad-musica', 'off');
  if (role === 'admin') localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'M', rol: 'administrador', origen: 'asistencia' }, token: TOKEN, server: KEY, expires: Date.now() + 3600e3 }));
  if (role === 'alumno') { localStorage.setItem('asistencia_user', JSON.stringify({ tipo: 'alumno', id: 'alumno_42', alumno_id: 42, dni: '33333333', nombre: 'Carlos M', server_key: KEY })); localStorage.setItem('asistencia_token', TOKEN); localStorage.setItem('ideas-student-cache', JSON.stringify({ savedAt: Date.now(), server_key: KEY, alumno_id: 42, data: student })); }
  if (role === 'trabajador') { localStorage.setItem('asistencia_user', JSON.stringify(worker)); localStorage.setItem('asistencia_token', TOKEN); }
}

async function open(browser, role, { width = 390, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: dark ? 'dark' : 'light' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const page = await ctx.newPage();
  const net = { latency: 120, calls: [], failNext: {}, mode: {} };
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/asistencia_ideas/api/**', async (route) => {
    const req = route.request(); let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    const name = req.url().split('/api/')[1].split('?')[0] + (body.accion ? ':' + body.accion : '');
    net.calls.push(name);
    await new Promise((r) => setTimeout(r, name.startsWith('estado_servidor') ? net.latency : 60));
    // Corte de red: la consulta no recibe respuesta (fetch lanza TypeError).
    if (net.failNext[name] > 0) { net.failNext[name]--; return route.abort('failed'); }
    const mode = name.startsWith('estado_servidor') ? net.mode.status : null;
    if (mode === 'redirect') return route.fulfill({ status: 302, headers: { Location: 'http://portal.example/' }, body: '' });
    if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Acceso Wi-Fi</html>' });
    let data = {};
    if (name.startsWith('personal_app')) data = body.accion === 'panel' ? panel : { items: [] };
    else if (name.startsWith('alumnos.php')) data = body.accion === 'perfil' ? student : { huella: 'h1' };
    else if (name.startsWith('get_perfil')) data = worker(KEY);
    const raw = name.startsWith('estado_servidor') ? { success: true } : { success: true, data };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(raw) });
  });
  await page.addInitScript(seed, { role, KEY, TOKEN, worker: worker(KEY), student });
  return { ctx, page, net, errors };
}
const count = (net, prefix) => net.calls.filter((c) => c.startsWith(prefix)).length;
const SHEET = '#net-test-sheet';

async function runTest(page) {
  await page.click(`${SHEET} [data-net-start]`);
  await page.waitForFunction((s) => document.querySelector(`${s} [data-net-status]`)?.textContent === 'Prueba terminada.', SHEET, { timeout: 30000 });
  return page.evaluate((s) => ({
    badge: document.querySelector(`${s} [data-net-result] .ios-badge`)?.textContent,
    net: document.querySelector(`${s} [data-net-result] .net-test__net`)?.textContent,
    rows: [...document.querySelectorAll(`${s} [data-net-result] .kv-row`)].map((r) => r.textContent.trim()),
    notes: [...document.querySelectorAll(`${s} [data-net-result] .net-test__notes li`)].map((li) => li.textContent),
    compare: document.querySelector(`${s} [data-net-compare]`)?.textContent.replace(/\s+/g, ' ').trim()
  }), SHEET);
}

// Ningún elemento visible de la hoja se sale de ella ni se monta sobre otro.
async function layoutProblems(page) {
  return page.evaluate((s) => {
    const sheet = document.querySelector(`${s} .sheet`); const box = sheet.getBoundingClientRect(); const out = [];
    const items = [...sheet.querySelectorAll('.segmented__item, .ios-btn, .kv-row__label, .kv-row__value, .ios-badge, .net-test__net, .sheet-hint, .net-test__notes li, .sheet__nav > *')]
      .filter((el) => el.offsetParent && el.getClientRects().length).map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of items) if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push('fuera: ' + el.className);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 1 && y > 1) out.push(`solape: ${a.el.className || a.el.tagName} / ${b.el.className || b.el.tagName}`);
    }
    return out;
  }, SHEET);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ORIGIN = 'http://127.0.0.1:' + server.address().port;
  BASE = ORIGIN + '/asistencia_ideas/pwa/index.html';
  KEY = ORIGIN + '/asistencia_ideas/api/';
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;

  // 1. Pantalla de ingreso: Wi-Fi, luego datos móviles y comparación.
  {
    const { ctx, page, net, errors } = await open(browser, 'login');
    await page.goto(BASE + '#login'); await page.waitForSelector('#btn-net-test');
    await page.click('#btn-net-test'); await page.waitForSelector(`${SHEET}:not([hidden])`);
    assert.equal(await page.getAttribute(`${SHEET} [data-net="wifi"]`, 'aria-checked'), 'true', 'Elige Wi-Fi según Android');
    const before = count(net, 'estado_servidor');
    const wifi = await runTest(page);
    assert.equal(count(net, 'estado_servidor') - before, 13, 'Hace 13 consultas');
    assert.equal(wifi.badge, 'Buena'); assert.equal(wifi.net, 'Wi-Fi');
    assert.ok(wifi.rows.some((r) => r.startsWith('Fallos') && r.endsWith('0 de 13')), wifi.rows.join(' | '));
    assert.match(wifi.compare, /apaga el Wi-Fi/);
    // Elegir «Datos móviles» con el Wi-Fi activo: se respeta la elección y se avisa.
    await page.click(`${SHEET} [data-net="datos"]`);
    assert.equal(await page.getAttribute(`${SHEET} [data-net="datos"]`, 'aria-checked'), 'true');
    assert.match(await page.textContent(`${SHEET} [data-net-detected]`), /apágalo/);
    // Cambio real de red: se elige sola.
    net.latency = 600;
    await page.evaluate(() => window.__setNet('cellular', '3g'));
    assert.match(await page.textContent(`${SHEET} [data-net-detected]`), /datos móviles \(calidad 3G\)/);
    const datos = await runTest(page);
    assert.equal(datos.badge, 'Aceptable'); assert.equal(datos.net, 'Datos móviles');
    assert.match(datos.compare, /Con datos móviles el servidor responde [\d.]+ veces más lento que con Wi-Fi/);
    await page.click(`${SHEET} [data-net-copy]`);
    await page.waitForFunction((s) => /copiado/.test(document.querySelector(`${s} [data-net-status]`).textContent), SHEET);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /^Prueba de conexión IDEAS v4\.2\.4 \(web\)/); assert.match(copied, /Datos móviles \(calidad 3G\)/); assert.match(copied, /Comparación:/);
    assert.doesNotMatch(copied, /11223344|Jorge|token/i, 'Sin datos personales');
    assert.deepEqual(await layoutProblems(page), []);
    if (shots) await page.screenshot({ path: path.join(shots, 'prueba-conexion.png') });
    // Cerrar a mitad de la prueba cancela las consultas restantes.
    await page.click(`${SHEET} [data-net-start]`); await page.waitForTimeout(700);
    await page.click(`${SHEET} [data-net-close]`); await page.waitForSelector(SHEET, { state: 'detached' });
    const atClose = count(net, 'estado_servidor'); await page.waitForTimeout(2000);
    assert.ok(count(net, 'estado_servidor') - atClose <= 1, 'No sigue consultando tras cerrar');
    // Al reabrir se ve el último resultado y la comparación.
    await page.click('#btn-net-test'); await page.waitForSelector(`${SHEET}:not([hidden])`);
    assert.match(await page.textContent(`${SHEET} [data-net-status]`), /Última prueba: Datos móviles/);
    assert.ok(!(await page.isHidden(`${SHEET} [data-net-copy]`)));
    assert.deepEqual(errors, []);
    console.log('OK prueba en el ingreso: Wi-Fi, datos móviles, comparación, copia y cancelación');
    await ctx.close();
  }

  // 2. Fallos: corte de red, Wi-Fi con página de acceso y respuesta ajena.
  {
    const { ctx, page, net, errors } = await open(browser, 'login', { width: 320, dark: true });
    await page.goto(BASE + '#login'); await page.waitForSelector('#btn-net-test');
    await page.click('#btn-net-test'); await page.waitForSelector(`${SHEET}:not([hidden])`);
    net.failNext['estado_servidor.php'] = 2;
    let r = await runTest(page);
    assert.equal(r.badge, 'Buena · con cortes'); assert.ok(r.notes.some((n) => /2 consultas fallaron: sin conexión con el servidor/.test(n)), r.notes.join(' | '));
    net.mode.status = 'redirect'; r = await runTest(page);
    assert.equal(r.badge, 'Sin conexión'); assert.ok(r.notes.some((n) => /página de acceso/.test(n)), r.notes.join(' | '));
    net.mode.status = 'html'; r = await runTest(page);
    assert.ok(r.notes.some((n) => /no es del servidor de IDEAS/.test(n)), r.notes.join(' | '));
    assert.deepEqual(await layoutProblems(page), []);
    if (shots) await page.screenshot({ path: path.join(shots, 'prueba-conexion-fallos-320-oscuro.png') });
    // Ingreso a 320 px: el botón nuevo no se monta sobre el estado ni la versión.
    await page.click(`${SHEET} [data-net-close]`); await page.waitForSelector(SHEET, { state: 'detached' });
    const footer = await page.evaluate(() => [...document.querySelectorAll('.login__footer > *')].map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
    for (let i = 1; i < footer.length; i++) assert.ok(footer[i][0] >= footer[i - 1][1] - 0.5, 'Pie del ingreso sin solapes');
    assert.deepEqual(errors, []);
    console.log('OK fallos clasificados (corte, portal Wi-Fi, respuesta ajena) y sin solapes a 320 px');
    await ctx.close();
  }

  // 3. Reintento: solo consultas de lectura y una sola vez.
  {
    const { ctx, page, net, errors } = await open(browser, 'trabajador');
    await page.goto(BASE + '#home'); await page.waitForTimeout(2500);
    const result = await page.evaluate(async ({ TOKEN }) => {
      const api = await import('./js/api.js'); const { netStats } = await import('./js/net-retry.js');
      const read = await api.apiRequest('jornada.php', { method: 'POST', body: { trabajador_id: 5, token_sesion: TOKEN } });
      const write = await api.apiRequest('marcar_asistencia.php', { method: 'POST', body: { trabajador_id: 5, token_sesion: TOKEN } });
      return { read: read.success, write: write.success, writeOffline: write.offline, stats: { ...netStats } };
    }, { TOKEN }).catch((e) => ({ error: e.message }));
    assert.ok(!result.error, result.error);
    // Se arma el corte justo antes de las consultas de prueba (la app ya hizo las suyas).
    assert.ok(result.read && result.write, 'Sin cortes todo responde');
    net.failNext['jornada.php'] = 1; net.failNext['marcar_asistencia.php'] = 1;
    const j0 = count(net, 'jornada'), m0 = count(net, 'marcar_asistencia');
    const after = await page.evaluate(async ({ TOKEN }) => {
      const api = await import('./js/api.js'); const { netStats } = await import('./js/net-retry.js');
      const read = await api.apiRequest('jornada.php', { method: 'POST', body: { trabajador_id: 5, token_sesion: TOKEN } });
      const write = await api.apiRequest('marcar_asistencia.php', { method: 'POST', body: { trabajador_id: 5, token_sesion: TOKEN } });
      return { read: read.success, write: write.success, writeOffline: write.offline, stats: { ...netStats } };
    }, { TOKEN });
    assert.equal(count(net, 'jornada') - j0, 2, 'La jornada se repite una vez'); assert.equal(after.read, true, 'y se recupera');
    assert.equal(count(net, 'marcar_asistencia') - m0, 1, 'La marcación nunca se repite'); assert.equal(after.writeOffline, true);
    assert.ok(after.stats.recovered >= 1);
    // Dos cortes seguidos: se rinde tras un reintento.
    net.failNext['get_perfil.php'] = 2; const p0 = count(net, 'get_perfil');
    const twice = await page.evaluate(async ({ TOKEN }) => (await (await import('./js/api.js')).apiRequest('get_perfil.php', { method: 'POST', body: { trabajador_id: 5, token_sesion: TOKEN } })).offline, { TOKEN });
    assert.equal(count(net, 'get_perfil') - p0, 2); assert.equal(twice, true);
    // Perfil del trabajador: fila nueva; Atrás de Android cierra la hoja.
    await page.evaluate(() => { location.hash = '#profile'; }); await page.waitForSelector('#btn-net-test');
    await page.click('#btn-net-test'); await page.waitForSelector(`${SHEET}:not([hidden])`);
    assert.equal(await page.evaluate(() => window.__androidBack()), 'handled'); await page.waitForSelector(SHEET, { state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('OK reintento solo de lectura (trabajador) y hoja en Perfil con Atrás');
    await ctx.close();
  }

  // 4. Personal (admin) y alumnos: reintento en sus capas y acceso desde Perfil.
  for (const role of ['admin', 'alumno']) {
    const { ctx, page, net, errors } = await open(browser, role);
    await page.goto(BASE + '#home'); await page.waitForTimeout(2500);
    const prefix = role === 'admin' ? 'personal_app.php' : 'alumnos.php';
    const read = role === 'admin' ? 'panel' : 'perfil', write = role === 'admin' ? 'guardar_prueba' : 'login';
    net.failNext[`${prefix}:${read}`] = 1; net.failNext[`${prefix}:${write}`] = 1;
    const c0 = count(net, `${prefix}:${read}`), w0 = count(net, `${prefix}:${write}`);
    const out = await page.evaluate(async ({ role, read, write }) => {
      const call = role === 'admin' ? (await import('./js/staff-api.js')).staffRequest : (await import('./js/student-api.js')).studentRequest;
      const r = await call(read).then(() => 'ok', (e) => e.message);
      const w = await call(write, role === 'alumno' ? { dni: '33333333', password: 'x' } : {}).then(() => 'ok', (e) => e.message);
      return { r, w };
    }, { role, read, write });
    assert.equal(out.r, 'ok', `${role}: la lectura se recupera`); assert.equal(count(net, `${prefix}:${read}`) - c0, 2);
    assert.notEqual(out.w, 'ok'); assert.equal(count(net, `${prefix}:${write}`) - w0, 1, `${role}: la escritura no se repite`);
    await page.evaluate(() => { location.hash = '#profile'; });
    const row = role === 'admin' ? '#staff-net-test' : '#student-net-test';
    await page.waitForSelector(row); await page.click(row); await page.waitForSelector(`${SHEET}:not([hidden])`);
    assert.equal(await page.evaluate(() => window.__androidBack()), 'handled'); await page.waitForSelector(SHEET, { state: 'detached' });
    assert.equal(await page.evaluate(() => location.hash), '#profile', 'Atrás solo cerró la hoja');
    if (shots) { await page.click(row); await page.waitForSelector(`${SHEET}:not([hidden])`); await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, `prueba-conexion-${role}.png`) }); }
    assert.deepEqual(errors, []);
    console.log(`OK ${role}: reintento solo de lectura y acceso desde Perfil`);
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log('Todas las pruebas de «Probar conexión» pasaron.');
})().catch((e) => { console.error(e); process.exit(1); });
