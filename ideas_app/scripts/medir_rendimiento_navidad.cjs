// Medición de rendimiento del Modo Navidad con el perfilador de Chrome (CDP Tracing).
// Simula un celular más lento (CPU ×4 por defecto) y mide 5 s por pantalla: fps, cuadros lentos,
// recálculos de estilo, repintados y animaciones activas. Servidor simulado: sin datos reales.
// Uso: node scripts/medir_rendimiento_navidad.cjs [variantes: full,lite,off] [pantallas] [cpu]
//   full = calidad completa (8 núcleos, 8 GB) · lite = celular de 2 GB (modo ligero) · off = sin Navidad
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const VARIANTS = (process.argv[2] || 'full,lite,off').split(',');
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
const CPU = Number(process.argv[4] || 4);
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
let URL, KEY;
const panel = {
  identidad: { id: 7, nombre: 'María Fernanda Quispe', rol: 'administrador', origen: 'asistencia', email: 'm@x.test', dni: '44556677', telefono: '987654321' },
  permisos: { estudiantes: true, ficha: true, trabajadores: true, asistencia: true },
  resumen: { marcaciones_hoy: 18, en_sede: 6, tardanzas_hoy: 2, trabajadores_activos: 24, alumnos: 412 },
  marcaciones: [{ nombres: 'Luis', apellidos: 'Torres', hora_entrada: '07:58:00', estado: 'Puntual' }, { nombres: 'Rosa', apellidos: 'Huamán', hora_entrada: '08:12:00', estado: 'Tardanza' }],
  accesos_web: [{ url: 'https://x.test/admin/', label: 'Panel administrativo', descripcion: 'Reportes' }],
};
const student = {
  alumno: { id: 42, dni: '33333333', nombre: 'Carlos', apellido: 'Mendoza', programa: 'Computación' },
  matriculas: [{ id: 1, periodo: '2026-II', estado: 'matriculado', programa: 'Computación', ciclo: 'III', seccion: 'A', turno: 'Mañana' }],
  cursos: [{ matricula_id: 1, nombre: 'Base de Datos', codigo: 'BD3', periodo: '2026-II', creditos: 4 }],
  horarios: [{ matricula_id: 1, periodo: '2026-II', curso: 'Base de Datos', dia: 3, hora_inicio: '09:00', hora_fin: '11:00', aula: '204' }],
  evaluaciones: [], pagos: [], pagos_historial: [], asistencia: null, huella: 'h1',
};
const worker = { tipo: 'trabajador', rol: 'trabajador', server_key: KEY, id: 5, trabajador_id: 5, dni: '11223344', nombre: 'Jorge Salazar', nombres: 'Jorge', apellidos: 'Salazar', codigo_interno: 'T-005', foto_url: '' };
const SCEN = {
  'admin-home-top': { kind: 'admin', hash: '#home' },
  'admin-home-scene': { kind: 'admin', hash: '#home', scroll: 'bottom' },
  'admin-profile': { kind: 'admin', hash: '#profile' },
  'alumno-home-scene': { kind: 'alumno', hash: '#home', scroll: 'bottom' },
  'trabajador-home': { kind: 'trabajador', hash: '#home' },
};
function seed({ kind, KEY, worker, student, off, lite, full }) {
  if (lite) Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
  if (full) { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); }
  if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear();
  const token = 'a'.repeat(64);
  if (kind === 'admin') localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'M', rol: 'administrador', origen: 'asistencia' }, token, server: KEY, expires: Date.now() + 3600e3 }));
  if (kind === 'alumno') { localStorage.setItem('asistencia_user', JSON.stringify({ tipo: 'alumno', id: 'alumno_42', alumno_id: 42, dni: '33333333', nombre: 'Carlos Mendoza', server_key: KEY })); localStorage.setItem('asistencia_token', token); localStorage.setItem('ideas-student-cache', JSON.stringify({ savedAt: Date.now(), server_key: KEY, alumno_id: 42, data: student })); }
  if (kind === 'trabajador') { localStorage.setItem('asistencia_user', JSON.stringify({ ...worker, server_key: KEY })); localStorage.setItem('asistencia_token', token); }
  localStorage.setItem('ideas-navidad-musica', 'off');
  if (off) localStorage.setItem('ideas-temporada', 'off');
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL = 'http://127.0.0.1:' + server.address().port + '/asistencia_ideas/pwa/index.html';
  KEY = 'http://127.0.0.1:' + server.address().port + '/asistencia_ideas/api/';
  const browser = await chromium.launch();
  const rows = [];
  for (const [name, sc] of Object.entries(SCEN)) {
    if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
    for (const variant of VARIANTS) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.route('**/asistencia_ideas/api/**', async (route) => {
        let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
        const url = route.request().url();
        const data = url.includes('personal_app') ? (body.accion === 'panel' ? panel : {}) : url.includes('alumnos.php') ? (body.accion === 'perfil' ? student : { huella: 'h1' }) : url.includes('get_perfil') ? worker : {};
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
      });
      await page.addInitScript(seed, { kind: sc.kind, KEY, worker, student, off: variant === 'off', lite: variant === 'lite', full: variant === 'full' });
      const cdp = await ctx.newCDPSession(page);
      await page.goto(URL + sc.hash);
      await page.waitForTimeout(2500);
      if (sc.scroll) await page.evaluate(() => { const s = document.querySelector('.view__scroll'); if (s) s.scrollTop = s.scrollHeight; });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      await page.waitForTimeout(1500);
      const events = [];
      cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
      const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.animations,disabled-by-default-devtools.timeline,v8.execute,toplevel', transferMode: 'ReportEvents' });
      await page.evaluate(() => { window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); }; window.__raf = requestAnimationFrame(tick); });
      await page.waitForTimeout(5000);
      const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__f.slice(1); });
      await cdp.send('Tracing.end'); await done;
      const info = await page.evaluate(() => ({ anims: document.getAnimations().length, decor: document.querySelectorAll('[data-ideas-decor], [data-ideas-decor] *').length }));
      // Hilo principal del renderizador.
      const threads = {}; events.filter((e) => e.ph === 'M' && e.name === 'thread_name').forEach((e) => { threads[e.pid + ':' + e.tid] = e.args.name; });
      const main = (e) => threads[e.pid + ':' + e.tid] === 'CrRendererMain';
      const sum = (n) => events.filter((e) => main(e) && e.name === n && e.dur).reduce((a, e) => a + e.dur, 0) / 1000;
      const count = (n) => events.filter((e) => main(e) && e.name === n).length;
      const busy = events.filter((e) => main(e) && e.name === 'ThreadControllerImpl::RunTask' && e.dur).reduce((a, e) => a + e.dur, 0) / 1000;
      const season = events.filter((e) => main(e) && e.name === 'FunctionCall' && e.dur && String(e.args?.data?.url || '').includes('ideas-season')).reduce((a, e) => a + e.dur, 0) / 1000;
      const failed = new Map();
      for (const e of events) {
        if (e.name !== 'Animation' || !e.args?.data) continue;
        const d = e.args.data; if (d.compositeFailed) failed.set(e.id2?.local || e.id || JSON.stringify(e.args), (d.unsupportedProperties || []).join('|') || 'reason ' + d.compositeFailed);
      }
      const reasons = {}; for (const r of failed.values()) reasons[r] = (reasons[r] || 0) + 1;
      const janky = frames.filter((f) => f > 34).length;
      rows.push({ escena: name, variante: variant, 'CPU ms': Math.round(busy), 'estilo ms': Math.round(sum('UpdateLayoutTree')), 'recálculos': count('UpdateLayoutTree'), 'layout ms': Math.round(sum('Layout')), 'pintado ms': Math.round(sum('Paint') + sum('PrePaint')), 'pintados': count('Paint'), 'script navidad ms': Math.round(season), 'fps': Math.round(frames.length / 5), 'cuadros lentos': janky, 'animaciones': info.anims, 'nodos': info.decor });
      if (process.env.REASONS) console.log(name, variant, reasons);
      await ctx.close();
    }
  }
  await browser.close();
  console.table(rows);
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
