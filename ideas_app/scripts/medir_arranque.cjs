// Arranque de la app por perfil con CPU limitada (servidor simulado, sin datos reales).
// Mide el tiempo hasta ver el contenido, módulos y KB de JS/CSS cargados, compilación, ejecución y estilos.
// Uso: node scripts/medir_arranque.cjs [perfiles: login,admin,alumno,trabajador] [cpu=4] [repeticiones=3]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/asistencia_ideas\//, '/'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const ROLES = (process.argv[2] || 'login,admin,alumno,trabajador').split(',');
const CPU = Number(process.argv[3] || 4), REP = Number(process.argv[4] || 3);
let ORIGIN, KEY, TOKEN = 'a'.repeat(64);
const panel = { identidad: { id: 7, nombre: 'María', rol: 'administrador', origen: 'asistencia' }, permisos: { estudiantes: true, trabajadores: true, asistencia: true }, resumen: { marcaciones_hoy: 18, en_sede: 6, tardanzas_hoy: 2 }, marcaciones: [] };
const student = { alumno: { id: 42, dni: '33333333', nombre: 'Carlos', apellido: 'M' }, matriculas: [], cursos: [], horarios: [], evaluaciones: [], pagos: [], pagos_historial: [], huella: 'h1' };
const worker = { tipo: 'trabajador', rol: 'trabajador', server_key: KEY, id: 5, trabajador_id: 5, dni: '11223344', nombre: 'Jorge Salazar', nombres: 'Jorge', apellidos: 'Salazar', codigo_interno: 'T-005', foto_url: '' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ORIGIN = 'http://127.0.0.1:' + server.address().port; KEY = ORIGIN + '/asistencia_ideas/api/';
  const b = await chromium.launch(); const rows = [];
  for (const role of ROLES) {
    const runs = [];
    for (let r = 0; r < REP; r++) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }); const page = await ctx.newPage();
      await page.route('**/asistencia_ideas/api/**', async (route) => { const u = route.request().url(); let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch {} await new Promise((x) => setTimeout(x, 300)); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(u.includes('estado_servidor') ? { success: true, temporada: true } : { success: true, data: u.includes('personal_app') ? panel : u.includes('alumnos.php') ? (body.accion === 'perfil' ? student : { huella: 'h1' }) : u.includes('get_perfil') ? worker : {} }) }); });
      await page.addInitScript(({ role, KEY, TOKEN, worker, student }) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1); localStorage.clear(); localStorage.setItem('ideas-navidad-musica', 'off');
        if (role === 'admin') localStorage.setItem('ideas-personal-session:v1', JSON.stringify({ identity: { id: 7, nombre: 'M', rol: 'administrador', origen: 'asistencia' }, token: TOKEN, server: KEY, expires: Date.now() + 3600e3 }));
        if (role === 'alumno') { localStorage.setItem('asistencia_user', JSON.stringify({ tipo: 'alumno', id: 'alumno_42', alumno_id: 42, dni: '33333333', nombre: 'Carlos M', server_key: KEY })); localStorage.setItem('asistencia_token', TOKEN); localStorage.setItem('ideas-student-cache', JSON.stringify({ savedAt: Date.now(), server_key: KEY, alumno_id: 42, data: student })); }
        if (role === 'trabajador') { localStorage.setItem('asistencia_user', JSON.stringify({ ...worker, server_key: KEY })); localStorage.setItem('asistencia_token', TOKEN); }
      }, { role, KEY, TOKEN, worker, student });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      const ev = []; cdp.on('Tracing.dataCollected', (e) => ev.push(...e.value)); const done = new Promise((x) => cdp.once('Tracing.tracingComplete', x));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,v8.execute,blink,loading', transferMode: 'ReportEvents' });
      const t0 = Date.now();
      await page.goto(ORIGIN + '/asistencia_ideas/pwa/index.html#' + (role === 'login' ? 'login' : 'home'));
      const ready = await page.waitForFunction((role) => {
        if (document.documentElement.classList.contains('sa-boot')) return false;
        if (role === 'login') return Boolean(document.getElementById('login-form'));
        return Boolean(document.querySelector('.hero .hero__name') && !document.querySelector('.staff-skeleton,.sa-loading'));
      }, role, { timeout: 30000, polling: 16 }).then(() => Date.now() - t0);
      await page.waitForTimeout(800);
      await cdp.send('Tracing.end'); await done;
      const res = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ n: e.name.split('/asistencia_ideas/')[1] || e.name, s: e.encodedBodySize || e.transferSize || 0 })));
      const th = {}; ev.filter((e) => e.ph === 'M' && e.name === 'thread_name').forEach((e) => { th[e.pid + ':' + e.tid] = e.args.name; });
      const main = ev.filter((e) => th[e.pid + ':' + e.tid] === 'CrRendererMain' && e.dur);
      const sum = (re) => Math.round(main.filter((e) => re.test(e.name)).reduce((a, e) => a + e.dur, 0) / 1000);
      runs.push({ ready, js: res.filter((x) => /\.js/.test(x.n)), css: res.filter((x) => /\.css/.test(x.n)),
        compile: sum(/^(v8\.compile|V8\.CompileCode|v8\.compileModule|V8\.CompileModule|v8\.parseOnBackground)$/), evaluate: sum(/^(v8\.evaluateModule|EvaluateScript|v8\.run)$/),
        cssParse: sum(/^(ParseAuthorStyleSheet|CSSParserImpl::parseStyleSheet)$/), style: sum(/^UpdateLayoutTree$/), layout: sum(/^Layout$/) });
      await ctx.close();
    }
    const last = runs[runs.length - 1];
    rows.push({ rol: role, 'listo ms (mediana)': median(runs.map((r) => r.ready)), 'módulos JS': last.js.length, 'KB JS': Math.round(last.js.reduce((a, x) => a + x.s, 0) / 1024), 'KB CSS': Math.round(last.css.reduce((a, x) => a + x.s, 0) / 1024), 'compilar ms': median(runs.map((r) => r.compile)), 'ejecutar ms': median(runs.map((r) => r.evaluate)), 'leer CSS ms': median(runs.map((r) => r.cssParse)), 'estilo ms': median(runs.map((r) => r.style)), 'layout ms': median(runs.map((r) => r.layout)) });
    if (process.env.LIST) console.log(role, last.js.map((x) => x.n.replace('pwa/', '') + ':' + Math.round(x.s / 1024)).join(' '));
  }
  console.table(rows); await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
