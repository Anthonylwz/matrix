// Pruebas de conexión 4.2.2 con un servidor simulado lento (sin datos reales ni red).
// Requiere Playwright con Chromium. Uso: node scripts/test_conexion.cjs
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const LAT = 400;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const TOKEN = 'a'.repeat(64);
let BASE, KEY;
const panel = { identidad: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, permisos: { estudiantes: true, trabajadores: true, asistencia: true }, resumen: { marcaciones_hoy: 18 }, marcaciones: [] };
const worker = (KEY) => ({ tipo: 'trabajador', rol: 'trabajador', server_key: KEY, id: 5, trabajador_id: 5, dni: '11223344', nombre: 'Jorge Salazar', nombres: 'Jorge', apellidos: 'Salazar', codigo_interno: 'T-005', foto_url: '' });

async function open(browser, seed, { loginFails = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const calls = [];
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/asistencia_ideas/api/**', async (route) => {
    const req = route.request(); let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    const name = req.url().split('/api/')[1].split('?')[0] + (body.accion ? ':' + body.accion : '');
    const entry = { name, start: Date.now() }; calls.push(entry);
    await new Promise((r) => setTimeout(r, LAT)); entry.end = Date.now();
    let status = 200, raw = { success: true, data: {} };
    if (name.startsWith('personal_app')) raw.data = body.accion === 'panel' ? panel : {};
    else if (name.startsWith('acceso_app')) raw.data = { continuar_trabajador: true };
    else if (name.startsWith('login_app')) { if (loginFails) { status = 401; raw = { success: false, message: 'Credenciales incorrectas' }; } else raw.data = { ...worker(KEY), token_sesion: TOKEN, sede_config: null, horario_config: null }; }
    else if (name.startsWith('estado_servidor')) raw = { success: true, temporada: true };
    else if (name.startsWith('get_perfil')) raw.data = worker(KEY);
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(raw) });
  });
  await page.addInitScript(seed, { KEY, TOKEN, worker: worker(KEY) });
  return { ctx, page, calls, errors };
}
const count = (calls, prefix) => calls.filter((c) => c.name.startsWith(prefix)).length;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port + '/asistencia_ideas/pwa/index.html';
  KEY = 'http://127.0.0.1:' + server.address().port + '/asistencia_ideas/api/';
  const browser = await chromium.launch();

  // 1. Pantalla de ingreso: una sola comprobación de servidor aunque varias partes la pidan.
  {
    const { ctx, page, calls, errors } = await open(browser, () => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); });
    await page.goto(BASE + '#login'); await page.waitForSelector('#login-form'); await page.waitForTimeout(1500);
    assert.equal(count(calls, 'estado_servidor'), 1, 'Una sola comprobación de servidor');
    assert.deepEqual(errors, []);
    console.log('OK comprobación de servidor compartida');
    await ctx.close();
  }
  // 2. Trabajador: la jornada y el historial salen antes que las consultas secundarias.
  {
    const { ctx, page, calls, errors } = await open(browser, ({ worker, TOKEN }) => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); localStorage.setItem('asistencia_user', JSON.stringify(worker)); localStorage.setItem('asistencia_token', TOKEN); });
    await page.goto(BASE + '#home'); await page.waitForTimeout(LAT * 4);
    const critical = calls.filter((c) => /^(jornada|historial)/.test(c.name));
    const secondary = calls.filter((c) => /^(permisos|correcciones|notificaciones|cambios_app|v1\/anuncios|estado_servidor)/.test(c.name));
    assert.ok(critical.length >= 2 && secondary.length >= 3, 'Hay consultas principales y secundarias');
    const firstCriticalEnd = Math.max(...critical.map((c) => c.end));
    assert.ok(secondary.every((c) => c.start >= firstCriticalEnd - 30), 'Las secundarias esperan a las principales');
    assert.deepEqual(errors, []);
    console.log('OK prioridad de consultas del trabajador');
    await ctx.close();
  }
  // 3. Admin con panel guardado: aparece al instante (sin esqueleto) y se actualiza en segundo plano.
  {
    const { ctx, page, calls, errors } = await open(browser, ({ KEY, TOKEN }) => {
      if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear();
      localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'M', rol: 'administrador', origen: 'asistencia' }, token: TOKEN, server: KEY, expires: Date.now() + 3600e3 }));
      localStorage.setItem('ideas-personal-panel:v1', JSON.stringify({ savedAt: Date.now() - 600e3, token: TOKEN, server: KEY, data: { identidad: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, permisos: { estudiantes: true, trabajadores: true, asistencia: true }, resumen: { marcaciones_hoy: 15 }, marcaciones: [] } }));
      new MutationObserver(() => { if (document.querySelector('.staff-skeleton')) window.__skeleton = true; }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(BASE + '#home'); await page.waitForSelector('.hero');
    const early = await page.evaluate(() => document.querySelector('.stat-tile__value')?.textContent);
    assert.equal(early, '15', 'Muestra el panel guardado antes de que responda el servidor');
    await page.waitForFunction(() => document.querySelector('.stat-tile__value')?.textContent === '18', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => Boolean(window.__skeleton)), false, 'No aparece el esqueleto de carga');
    assert.equal(count(calls, 'personal_app.php:panel'), 1);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('ideas-personal-panel:v1'))).data.resumen.marcaciones_hoy, 18, 'Guarda el panel nuevo');
    // Cerrar sesión borra el panel guardado.
    await page.goto(BASE + '#profile'); await page.waitForSelector('#staff-logout'); await page.click('#staff-logout');
    await page.waitForSelector('.action-sheet__btn', { state: 'visible' });
    await Promise.all([page.waitForEvent('load'), page.locator('.action-sheet__btn', { hasText: 'Cerrar sesión' }).click()]);
    await page.waitForSelector('#login-form');
    assert.equal(await page.evaluate(() => localStorage.getItem('ideas-personal-panel:v1')), null, 'Cerrar sesión borra el panel guardado');
    assert.deepEqual(errors, []);
    console.log('OK admin abre al instante y cerrar sesión borra el panel guardado');
    await ctx.close();
  }
  // 4. Trabajador vinculado y confirmado: entra en un viaje; si falla, el siguiente intento usa el acceso normal.
  const linked = ({ worker, KEY }) => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); localStorage.setItem('asistencia_user', JSON.stringify(worker)); localStorage.setItem('asistencia_bloqueada', '1'); localStorage.setItem('ideas-acceso-trabajador:v1', JSON.stringify({ dni: '11223344', server: KEY, at: Date.now() - 86400e3 })); };
  const submit = async (page) => { await page.fill('#login-dni', '11223344'); await page.fill('#login-password', 'secreto123'); await page.evaluate(() => document.getElementById('login-form').requestSubmit()); };
  {
    const { ctx, page, calls, errors } = await open(browser, linked);
    await page.goto(BASE + '#login'); await page.waitForSelector('#login-form'); await page.waitForTimeout(600);
    await submit(page); await page.waitForFunction(() => location.hash === '#home', null, { timeout: 8000 });
    assert.equal(count(calls, 'acceso_app'), 0, 'Sin el viaje de acceso unificado');
    assert.equal(count(calls, 'login_app'), 1, 'Un solo viaje de ingreso');
    assert.deepEqual(errors, []);
    console.log('OK desbloqueo directo del trabajador vinculado (1 viaje)');
    await ctx.close();
  }
  {
    const { ctx, page, calls, errors } = await open(browser, linked, { loginFails: true });
    await page.goto(BASE + '#login'); await page.waitForSelector('#login-form'); await page.waitForTimeout(600);
    await submit(page); await page.waitForFunction(() => !document.getElementById('login-error')?.hidden, null, { timeout: 8000 });
    assert.equal(count(calls, 'acceso_app'), 0);
    await submit(page); await page.waitForFunction((n) => true, null); await page.waitForTimeout(LAT * 3);
    assert.equal(count(calls, 'acceso_app'), 1, 'Tras un fallo, el siguiente intento usa el acceso normal');
    assert.deepEqual(errors, []);
    console.log('OK vuelta al acceso normal si el ingreso directo falla');
    await ctx.close();
  }
  {
    const { ctx, page, calls } = await open(browser, ({ worker, KEY }) => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); localStorage.setItem('asistencia_user', JSON.stringify(worker)); localStorage.setItem('asistencia_bloqueada', '1'); localStorage.setItem('ideas-acceso-trabajador:v1', JSON.stringify({ dni: '11223344', server: KEY, at: Date.now() - 8 * 86400e3 })); });
    await page.goto(BASE + '#login'); await page.waitForSelector('#login-form'); await page.waitForTimeout(600);
    await submit(page); await page.waitForFunction(() => location.hash === '#home', null, { timeout: 8000 });
    assert.equal(count(calls, 'acceso_app'), 1, 'Una pista vencida (más de 7 días) vuelve a confirmar con el servidor');
    assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('ideas-acceso-trabajador:v1'))).at > Date.now() - 60e3, 'Y la renueva');
    console.log('OK la pista vence a los 7 días y se renueva');
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log('Todas las pruebas de conexión pasaron.');
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
