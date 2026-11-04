// Pruebas de interfaz 4.1.8 con un servidor simulado (sin datos reales ni red).
// Requiere Playwright con Chromium. Uso: node scripts/test_navidad_ui.cjs
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const ADMIN = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/asistencia_ideas/public/ideas-season.css"></head><body class="admin-body"><aside class="sidebar-brand"><div class="brand-logo">IDEAS</div></aside><a id="out" href="logout.php">Salir</a><script src="/asistencia_ideas/public/ideas-season.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/admin/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(ADMIN); }
  if (url === '/admin/logout.php') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('saliste'); }
  const file = path.join(ROOT, url.replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
let BASE, KEY, ORIGIN;
const TOKEN = 'a'.repeat(64);
const panel = {
  identidad: { id: 7, nombre: 'María Fernanda Quispe', rol: 'administrador', origen: 'asistencia', email: 'm@x.test', dni: '44556677' },
  permisos: { estudiantes: true, ficha: true, trabajadores: true, asistencia: true },
  resumen: { marcaciones_hoy: 18, en_sede: 6, tardanzas_hoy: 2, trabajadores_activos: 24, alumnos: 412, secciones: 9, trabajadores_inactivos: 1 },
  marcaciones: Array.from({ length: 12 }, (_, i) => ({ nombres: 'Persona', apellidos: String(i), hora_entrada: '08:0' + (i % 10) + ':00', estado: i % 3 ? 'Puntual' : 'Tardanza' })),
};
let calls = [], failPanel = false;
async function setup(browser, seedFn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/asistencia_ideas/api/**', async (route) => {
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
    calls.push(body.accion || route.request().url());
    if (body.accion === 'panel' && failPanel) return route.abort('failed');
    const data = body.accion === 'panel' ? panel : body.accion === 'buscar_alumnos' ? { page: 1, pages: 1, total: 0, items: [] } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.addInitScript(seedFn, { KEY, TOKEN });
  return { ctx, page, errors };
}
const seedAdmin = ({ KEY, TOKEN }) => {
  if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); localStorage.clear();
  localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, token: TOKEN, server: KEY, expires: Date.now() + 3600e3 }));
};
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ORIGIN = 'http://127.0.0.1:' + server.address().port;
  BASE = ORIGIN + '/asistencia_ideas/pwa/index.html';
  KEY = ORIGIN + '/asistencia_ideas/api/';
  const browser = await chromium.launch();
  // 1. Cierre de sesión del administrador: cancelar y confirmar.
  {
    const { ctx, page, errors } = await setup(browser, seedAdmin);
    await page.goto(BASE + '#profile'); await page.waitForSelector('#staff-logout');
    calls = [];
    await page.click('#staff-logout');
    await page.waitForSelector('.action-sheet__btn', { state: 'visible' });
    const text = await page.textContent('body');
    assert.match(text, /¿Cerrar sesión\?/); assert.match(text, /panel de administración/);
    assert.ok(!calls.includes('salir'), 'No cierra sin confirmar');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await page.waitForTimeout(600);
    assert.ok(await page.$('#staff-logout'), 'Cancelar mantiene la sesión');
    assert.ok(await page.evaluate(() => Boolean(localStorage.getItem('ideas-personal-session:v1'))));
    await page.click('#staff-logout');
    await page.waitForSelector('.action-sheet__btn', { state: 'visible' });
    await Promise.all([page.waitForEvent('load'), page.locator('.action-sheet__btn', { hasText: 'Cerrar sesión' }).click()]);
    await page.waitForSelector('#login-form');
    assert.ok(calls.includes('salir'), 'Avisa al servidor');
    assert.ok(!(await page.evaluate(() => localStorage.getItem('ideas-personal-session:v1'))), 'Borra la sesión');
    assert.deepEqual(errors, []);
    console.log('OK cierre de sesión de administrador (cancelar/confirmar)');
    await ctx.close();
  }
  // 2. Refresco en segundo plano: sin esqueleto y conservando el desplazamiento; error = aviso sin perder datos.
  {
    const { ctx, page, errors } = await setup(browser, seedAdmin);
    await page.goto(BASE + '#home'); await page.waitForSelector('.hero');
    await page.evaluate(() => { document.querySelector('.view__scroll').scrollTop = 400; });
    const before = await page.evaluate(() => document.querySelector('.view__scroll').scrollTop);
    calls = [];
    await page.evaluate(() => { window.__sawSkeleton = false; new MutationObserver(() => { if (document.querySelector('.staff-skeleton')) window.__sawSkeleton = true; }).observe(document.body, { childList: true, subtree: true }); window.dispatchEvent(new Event('online')); });
    await page.waitForTimeout(800);
    assert.ok(calls.includes('panel'), 'Vuelve a consultar');
    assert.equal(await page.evaluate(() => window.__sawSkeleton), false, 'No muestra esqueleto');
    const after = await page.evaluate(() => document.querySelector('.view__scroll').scrollTop);
    assert.ok(Math.abs(after - before) <= 12, `Conserva el desplazamiento (${before} → ${after})`);
    assert.match(await page.textContent('.sa-sync-note'), /Actualizado \d/);
    failPanel = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(800);
    assert.ok(await page.$('.hero'), 'Un fallo en segundo plano no borra la pantalla');
    assert.match(await page.textContent('#toast-container'), /No se pudo actualizar/);
    failPanel = false;
    assert.deepEqual(errors, []);
    console.log('OK refresco silencioso (sin parpadeo, mantiene scroll, tolera fallos)');
    await ctx.close();
  }
  // 3. Modo Navidad: adornos solo en espacios reservados; apagar los quita; escáner los oculta.
  {
    const { ctx, page, errors } = await setup(browser, seedAdmin);
    await page.goto(BASE + '#home'); await page.waitForSelector('.ideas-xmas-scene');
    assert.equal(await page.$$eval('.ideas-christmas-layer,.ideas-christmas-audio', (n) => n.length), 0, 'Sin capas fijas');
    assert.equal(await page.$$eval('.ideas-hero-decor', (n) => n.length), 1);
    // Piezas nuevas de 4.1.8: todas dentro de sus espacios propios.
    for (const sel of ['.ideas-sleigh', '.ideas-shooting', '.ideas-aurora', '.ideas-glint--sky', '.ideas-cabin', '.ideas-smoke', '.ideas-cane', '.ideas-countdown', '.ideas-glint--hero', '.ideas-bell', '.ideas-note-flake'])
      assert.ok(await page.$(sel), `Falta ${sel}`);
    assert.match(await page.textContent('.ideas-countdown'), /Faltan \d+ días|Nochebuena|Feliz Navidad|Año Nuevo|Mañana/);
    assert.ok(await page.$eval('.ideas-sleigh', (el) => el.closest('.ideas-xmas-scene') !== null), 'El trineo vuela solo dentro de la escena');
    // 4.2.0: tarjetas, títulos, vida y celebración.
    assert.ok(await page.$$eval('.ios-card.ideas-frost', (n) => n.length) >= 2, 'Escarcha en las tarjetas');
    assert.ok(await page.$$eval('.stat-tile > .ideas-tile-orn', (n) => n.length) >= 3, 'Esferas en las estadísticas');
    assert.ok(await page.$$eval('.ideas-head-icon', (n) => n.length) >= 3, 'Íconos junto a los títulos');
    for (const sel of ['.ideas-clouds', '.ideas-tree-lights', '.ideas-tree-halo', '.ideas-tree-drop', '.ideas-stardust', '.ideas-bulbs--3', '.sm-hat', '.sm-scarf', '.sm-breath', '.sm-eyes', '.ideas-sleigh-legs'])
      assert.ok(await page.$(sel), `Falta ${sel}`);
    assert.match(await page.$eval('.ideas-xmas-scene', (el) => el.className), /ideas-scene--(dia|tarde|noche)/, 'Cielo según la hora');
    assert.ok(['cadena', 'destello', 'alterno', 'respira'].includes(await page.evaluate(() => document.documentElement.dataset.ideasLuces)), 'Programa de luces activo');
    await page.locator('.ideas-xmas-scene').scrollIntoViewIfNeeded();
    await page.locator('.ideas-xmas-scene').click();
    assert.ok(await page.$eval('.ideas-xmas-scene', (el) => el.classList.contains('ideas-celebrate')), 'Tocar la escena la celebra');
    assert.ok(await page.$$eval('.ideas-burst .ideas-flake', (n) => n.length) > 0, 'Ráfaga de nieve al tocar');
    await page.waitForTimeout(2700);
    assert.equal(await page.$$eval('.ideas-burst', (n) => n.length), 0, 'La ráfaga se limpia sola');
    assert.equal(await page.$eval('.ideas-xmas-scene', (el) => el.classList.contains('ideas-celebrate')), false);
    await page.goto(BASE + '#students'); await page.waitForSelector('.ideas-page-footer');
    assert.ok(await page.$('.ideas-page-footer .ideas-penguin') && await page.$('.ideas-page-footer .ideas-lamp'), 'Pie nevado con farol y pingüino');
    await page.goto(BASE + '#profile'); await page.waitForSelector('.ideas-avatar-decor');
    for (const sel of ['.ideas-avatar-orbit', '.ideas-side-snow', '.ideas-title-flake']) assert.ok(await page.$(sel), `Falta ${sel}`);
    // La escena de «Hoy» ya no está en pantalla; lo visible no queda en pausa.
    assert.equal(await page.$eval('.ideas-avatar-decor', (el) => el.classList.contains('ideas-offscreen')), false);
    await page.click('[data-ideas-season-toggle]');
    await page.waitForTimeout(300);
    assert.equal(await page.$$eval('[data-ideas-decor]', (n) => n.length), 0, 'Apagar quita los adornos');
    assert.equal(await page.$$eval('.ideas-avatar-decorated', (n) => n.length), 0, 'Y devuelve el espacio reservado');
    assert.equal(await page.$$eval('.ideas-frost', (n) => n.length), 0, 'Y quita la escarcha de las tarjetas');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-ideas-luces')), false, 'Y detiene los programas de luces');
    await page.click('[data-ideas-season-toggle]');
    await page.waitForTimeout(300);
    assert.ok(await page.$('.ideas-avatar-decor'), 'Encender los repone');
    await page.evaluate(() => document.body.classList.add('is-immersive'));
    assert.equal(await page.$eval('.ideas-avatar-decor', (el) => getComputedStyle(el).display), 'none');
    // Sin bucle de mutaciones: tras estabilizar (el observador de visibilidad marca una vez lo que está fuera de pantalla), no siguen cambiando nodos.
    await page.waitForTimeout(700);
    const churn = await page.evaluate(() => new Promise((r) => { let n = 0; const o = new MutationObserver((m) => { n += m.length; }); o.observe(document.body, { childList: true, subtree: true, attributes: true }); setTimeout(() => { o.disconnect(); r(n); }, 1500); }));
    assert.equal(churn, 0, 'Sin bucle de repintado');
    assert.deepEqual(errors, []);
    console.log('OK Modo Navidad (sin capas fijas, apagado, escáner, sin bucles)');
    await ctx.close();
  }
  // 4. Panel web de administración: diálogo antes de salir.
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ORIGIN + '/admin/index.html');
    assert.ok(await page.$('.sidebar-brand .ideas-garland--admin'), 'Guirnalda dentro de la marca');
    await page.click('#out');
    await page.waitForSelector('dialog.ideas-logout-dialog[open]');
    assert.match(page.url(), /index\.html$/, 'No sale sin confirmar');
    await page.click('.ideas-logout-cancel');
    assert.equal(await page.$('dialog.ideas-logout-dialog'), null);
    await page.click('#out');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('dialog.ideas-logout-dialog'), null, 'Esc cancela');
    await page.click('#out');
    await Promise.all([page.waitForRequest(/logout\.php$/), page.click('.ideas-logout-confirm')]);
    assert.deepEqual(errors, []);
    console.log('OK panel web: confirmación de cierre de sesión');
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log('Todas las pruebas de interfaz pasaron.');
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
