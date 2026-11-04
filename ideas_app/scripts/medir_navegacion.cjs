// Cambio de pestaña repetido por perfil con CPU limitada (servidor simulado, sin datos reales).
// Mide la latencia hasta el segundo cuadro y si crecen escuchas, nodos o memoria (fugas).
// Uso: node scripts/medir_navegacion.cjs [perfiles: admin,alumno,trabajador] [cpu=4] [vueltas=6] [off]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const ROLES = (process.argv[2] || 'admin,alumno,trabajador').split(','), CPU = Number(process.argv[3] || 4), LOOPS = Number(process.argv[4] || 6), OFF = process.argv[5] === 'off';
let ORIGIN, KEY, TOKEN = 'a'.repeat(64);
const TABS = { admin: ['home', 'students', 'team', 'profile'], alumno: ['home', 'studies', 'attendance', 'pagos', 'profile'], trabajador: ['home', 'history', 'requests', 'profile'] };
const panel = { identidad: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, permisos: { estudiantes: true, ficha: true, trabajadores: true, asistencia: true }, resumen: { marcaciones_hoy: 18 }, marcaciones: [] };
const student = { alumno: { id: 42, dni: '33333333', nombre: 'Carlos', apellido: 'M' }, matriculas: [{ id: 1, periodo: '2026-II', estado: 'matriculado', programa: 'Comp' }], cursos: [], horarios: [], evaluaciones: [], pagos: [], pagos_historial: [], huella: 'h1' };
const worker = { tipo: 'trabajador', rol: 'trabajador', server_key: KEY, id: 5, trabajador_id: 5, dni: '11223344', nombre: 'Jorge Salazar', nombres: 'Jorge', apellidos: 'Salazar', codigo_interno: 'T-005', foto_url: '' };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ORIGIN = 'http://127.0.0.1:' + server.address().port; KEY = ORIGIN + '/asistencia_ideas/api/';
  const b = await chromium.launch(); const rows = [];
  for (const role of ROLES) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/asistencia_ideas/api/**', async (route) => { const u = route.request().url(); let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {} await new Promise((x) => setTimeout(x, 120));
      const data = u.includes('personal_app') ? (body.accion === 'panel' ? panel : body.accion === 'buscar_alumnos' ? { page: 1, pages: 1, total: 0, items: [] } : { items: [] }) : u.includes('alumnos.php') ? (body.accion === 'perfil' ? student : { huella: 'h1' }) : u.includes('get_perfil') ? worker : {};
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(u.includes('estado_servidor') ? { success: true } : { success: true, data }) }); });
    await page.addInitScript(({ role, KEY, TOKEN, worker, student, OFF }) => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); localStorage.setItem('ideas-navidad-musica', 'off'); if (OFF) localStorage.setItem('ideas-temporada', 'off');
      if (role === 'admin') localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'M', rol: 'administrador', origen: 'asistencia' }, token: TOKEN, server: KEY, expires: Date.now() + 3600e3 }));
      if (role === 'alumno') { localStorage.setItem('asistencia_user', JSON.stringify({ tipo: 'alumno', id: 'alumno_42', alumno_id: 42, dni: '33333333', nombre: 'Carlos M', server_key: KEY })); localStorage.setItem('asistencia_token', TOKEN); localStorage.setItem('ideas-student-cache', JSON.stringify({ savedAt: Date.now(), server_key: KEY, alumno_id: 42, data: student })); }
      if (role === 'trabajador') { localStorage.setItem('asistencia_user', JSON.stringify({ ...worker, server_key: KEY })); localStorage.setItem('asistencia_token', TOKEN); } }, { role, KEY, TOKEN, worker, student, OFF });
    const cdp = await ctx.newCDPSession(page);
    await page.goto(ORIGIN + '/asistencia_ideas/pwa/index.html#home'); await page.waitForTimeout(2500);
    const counters = async () => { await cdp.send('HeapProfiler.collectGarbage'); const d = await cdp.send('Memory.getDOMCounters'); const h = await cdp.send('Runtime.getHeapUsage'); return { nodes: d.nodes, listeners: d.jsEventListeners, heap: Math.round(h.usedSize / 1024) }; };
    // Una vuelta de calentamiento y luego la medición.
    for (const tab of TABS[role]) { await page.evaluate((t) => { location.hash = '#' + t; }, tab); await page.waitForTimeout(700); }
    const before = await counters();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const lat = [];
    for (let l = 0; l < LOOPS; l++) for (const tab of TABS[role]) {
      const ms = await page.evaluate((t) => new Promise((resolve) => {
        const t0 = performance.now(); location.hash = '#' + t;
        // Hasta el segundo cuadro después del cambio (pantalla nueva pintada).
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
      }), tab);
      lat.push(ms); await page.waitForTimeout(450);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await page.waitForTimeout(1500);
    const after = await counters();
    lat.sort((a, c) => a - c);
    rows.push({ rol: role, navidad: OFF ? 'no' : 'sí', cambios: lat.length, 'mediana ms': Math.round(lat[Math.floor(lat.length / 2)]), 'p90 ms': Math.round(lat[Math.floor(lat.length * 0.9)]), 'escuchas antes→después': `${before.listeners}→${after.listeners}`, 'nodos antes→después': `${before.nodes}→${after.nodes}`, 'memoria KB antes→después': `${before.heap}→${after.heap}`, errores: errors.length });
    await ctx.close();
  }
  console.table(rows); await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
