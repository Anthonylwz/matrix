import { initStudentPush, studentPushSettingsMarkup, studentNoticesMarkup, bindStudentPushControls } from './student-push.js';
import { studentWebLoginMarkup, bindStudentWebLogin, intranetQrOpen, handleIntranetQrBack } from './student-web-login.js';
import { studentRequest, studentSession, clearStudentSession, consumeStudentBootstrap, rememberStudentIdentity, saveStudentCache, loadStudentCache, loadStudentUi, saveStudentUi } from './student-api.js';
import { initTheme, themeChanging } from './theme.js';
import { forgetStudentBiometric } from './student-biometric.js';
import { attendanceMarkup, bindAttendance, attendanceBusy, attendanceSheetOpen, pendingMarks, syncPendingMarks, pendingMarkCount } from './student-attendance.js';
import { studentSettingsMarkup, studentProfileDataMarkup, bindStudentSettings, editingAccount, accountBusy, handleStudentSettingsBack } from './student-settings.js';
import { icon, rowIcon } from './icons.js';
import { ICON_CHEVRON, APP_VERSION, showToast, showActionSheet } from './utils.js';
import { useProfileServerControls, studentServerInfo, openStudentServerSettings } from './student-server.js';
import { normalizeSearch, matchesSearch, sortClasses, shouldAutoRefresh, academicPeriods, defaultPeriod, primaryEnrollment, inPeriod, nextWeeklyClass, currentEnrollmentSchedule, paymentState, paymentTotals, paymentNet } from './student-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 9 10-5 10 5-10 5-10-5Z"/><path d="M6 11v6c3 3 9 3 12 0v-6M22 9v7"/></svg>';
const book='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/></svg>';
// Mismos íconos duotono de la barra de trabajadores (el relleno .duo aparece en la pestaña activa).
const tabIcons={
  home:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="duo" x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="m16 20 2 2 4-4"/></svg>',
  studies:'<svg viewBox="0 0 24 24" aria-hidden="true"><path class="duo" d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  schedule:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="duo" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  attendance:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="duo" x="3" y="3" width="7" height="7" rx="1"/><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M20 20v.01M17 17v3"/></svg>',
  pagos:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="duo" x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>',
  profile:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="duo" cx="12" cy="12" r="10"/><path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/></svg>'
};
const tabs=[['home','Hoy',tabIcons.home],['studies','Estudios',tabIcons.studies],['attendance','Asistencia',tabIcons.attendance],['pagos','Pagos',tabIcons.pagos],['profile','Perfil',tabIcons.profile]];
const androidApp=()=>typeof window.AndroidNet?.getServer==='function';
const days=['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
let data=null,loading=false,generation=0,error='',segment='cursos',loggingOut=false;
let lastSuccess=0,lastAttempt=0,searchQuery='',scheduleDay='all',lastScreen='',period='',offline=navigator.onLine===false;
const scrollPositions=new Map();
const editing=()=>editingAccount()||attendanceBusy()||attendanceSheetOpen()||intranetQrOpen();
// Sondeo ligero: cada 30 s (solo con la app visible) se pide una huella de cambios; el perfil completo se descarga
// únicamente cuando la huella cambia y se repinta sin parpadeo. Nada se refresca "por si acaso".
const POLL_MS=30000;let huella=null,pendingRender=false,pollTimer=null,stale=false;
function schedulePoll(){clearTimeout(pollTimer);if(document.hidden||loggingOut)return;pollTimer=setTimeout(checkChanges,POLL_MS);}
async function syncMarks(manual=false){
  if(!pendingMarkCount()){if(manual)showToast('No hay marcas pendientes.','info');return;}
  const r=await syncPendingMarks();
  r.sent.forEach(s=>showToast(`Asistencia enviada: ${s.curso} (${s.estado==='tardanza'?'tardanza':'presente'})`,s.estado==='tardanza'?'warning':'success',4500));
  r.rejected.forEach(x=>showToast(`Marca de las ${String(x.capturado_en).slice(11,16)} no aceptada: ${x.message}`,'danger',6000));
  if(r.sent.length)await refresh({silent:true});
  if(manual&&!r.sent.length&&!r.rejected.length)showToast('Aún sin conexión con el servidor. Se reintentará sola.','warning');
  if((manual||r.sent.length||r.rejected.length)&&!editing())render(true);
}
async function checkChanges(){
  clearTimeout(pollTimer);
  if(document.hidden||loggingOut||loading||attendanceBusy()||navigator.onLine===false||!studentSession()){schedulePoll();return;}
  if(pendingMarkCount())await syncMarks();
  try{
    const res=await studentRequest('cambios');
    if(stale){stale=false;if(!editing())render();}
    if(res?.huella&&res.huella!==huella)await refresh({silent:true});
  }catch(e){
    // Servidor caído: se conservan los datos guardados y solo se avisa en la barra superior.
    if(e?.offline&&!stale){stale=true;if(!editing())render();}
  }
  schedulePoll();
}
function idle(){if(editing())return;if(pendingRender){pendingRender=false;}render();checkChanges();}
function autoRefresh(){if(themeChanging())return;const was=offline;offline=navigator.onLine===false;if(!data){refresh();return;}if(was!==offline&&!editing())render();if(!offline)checkChanges();}
const labels={activo:'Activo',inactivo:'Inactivo',egresado:'Egresado',suspendido:'Suspendido',matriculado:'Matriculado',pendiente_pago:'Pendiente de pago',anulado:'Anulado',finalizado:'Finalizado'};
const label=value=>labels[value]||value||'Sin asignar';
const list=(key)=>inPeriod(Array.isArray(data?.[key])?data[key]:[],period);
function periodSelector(){const periods=academicPeriods(data);return periods.length?`<div class="sa-period"><label for="student-period">Periodo académico</label><select id="student-period" class="ios-input">${periods.map(value=>`<option value="${esc(value)}" ${value===period?'selected':''}>${esc(value)}</option>`).join('')}<option value="*" ${period==='*'?'selected':''}>Todos los periodos</option></select></div>`:'';}
function placeholder(){return error?empty('Necesitamos conexión con tu intranet','Tu cuenta sigue abierta. Reintenta para consultar tu información actualizada.',icon('offline')):'<div class="ios-card sa-loading" role="status"><span class="spinner"></span><h2>Cargando tu información</h2><p>Estamos consultando tu cuenta de la intranet.</p><div class="sa-skeleton"></div><div class="sa-skeleton"></div></div>';}
function empty(title,message,symbol=book){return `<div class="empty-state sa-empty"><span class="sa-empty-icon">${symbol}</span><h2>${title}</h2><p>${message}</p></div>`;}
function route(){const hash=location.hash.slice(1).split('?')[0];if(hash==='enrollments'||hash==='schedule')return 'studies';return hash==='notifications'?'notifications':tabs.some(t=>t[0]===hash)?hash:'home';}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase();}
function dateLima(){return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'long',day:'numeric',month:'long'}).format(new Date());}
function todayNumber(){const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',weekday:'short'}).format(new Date());return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(day)+1;}
function header(title){return `<header class="nav-bar"><div class="nav-bar__leading"><span class="sa-brand">IDEAS</span></div><div class="nav-bar__title" aria-hidden="true">${title}</div><div class="nav-bar__trailing"><span class="connection-pill ${(offline||error||stale)?'offline':loading?'syncing':'online'}" role="status" aria-label="${offline?'Sin conexión':stale?'Sin conexión con el servidor':error?'Sin actualizar':loading?'Actualizando':'Conectado a intranet'}"><span class="connection-dot"></span><span class="connection-pill__text">${offline?'Sin conexión':stale?'Sin servidor':error?'Sin actualizar':loading?'Actualizando':'Intranet'}</span></span><button class="nav-btn" type="button" id="student-refresh" aria-label="Actualizar mis datos" ${loading?'disabled':''}>${icon('refresh')}</button></div></header>`;}
// Con sesión de alumno no se carga app.js; también debe avisar de una web nueva.
function watchStudentServiceWorkerUpdates(){
  if(!('serviceWorker' in navigator)||location.hostname==='appassets.androidplatform.net')return;
  navigator.serviceWorker.ready.then(reg=>{
    if(reg.scope!==new URL('../',import.meta.url).href)return;
    let announced=false;
    const announce=()=>{
      if(announced||!navigator.serviceWorker.controller)return;
      announced=true;
      showToast('Hay una versión nueva. Cierra todas las pestañas de esta app y vuelve a abrirla para actualizar.','info',12000);
    };
    if(reg.waiting)announce();
    const watch=()=>{const worker=reg.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')announce();});};
    reg.addEventListener('updatefound',watch);watch();
  }).catch(()=>{});
}
export function initStudentApp(){
  initTheme();
  watchStudentServiceWorkerUpdates();
  window.addEventListener('student:push-updated',()=>{if(['profile','notifications'].includes(route()))render();});
  initStudentPush();
  document.body.classList.add('student-mode');document.body.classList.remove('no-bottom-nav');
  document.getElementById('ios-install-banner')?.remove();
  if(!document.querySelector('link[href*="css/student-app.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('../css/student-app.css?v=21',import.meta.url).href;link.dataset.studentStyle='';document.head.append(link);}
  const stage=document.getElementById('app-view');stage.innerHTML='<section class="view view--tab student-view"></section>';
  const nav=document.getElementById('bottom-nav');nav.hidden=false;nav.setAttribute('aria-label','Secciones del estudiante');
  nav.innerHTML=tabs.map(([key,title,svg])=>`<a href="#${key}" class="tab-item" data-route="${key}">${svg}<span>${title}</span></a>`).join('');
  // Android muestra su botón "Configurar servidor" bajo la barra si no hay sesión de trabajador; en alumnos el servidor se cambia desde Perfil.
  useProfileServerControls();
  data=consumeStudentBootstrap();let cachedAt=0;
  if(data)saveStudentCache(data);
  else{const cached=loadStudentCache();if(cached){data=cached.data;cachedAt=cached.savedAt;}}
  period=defaultPeriod(data);
  const ui=loadStudentUi();
  if(ui){if(['cursos','matriculas','horario','evaluaciones'].includes(ui.segment))segment=ui.segment;if(ui.period==='*'||(ui.period&&academicPeriods(data).includes(ui.period)))period=ui.period;}
  window.__androidBack=()=>{if(handleIntranetQrBack()||handleStudentSettingsBack())return 'handled';if(route()!=='home'){location.hash='#home';return 'handled';}return 'exit';};
  const applyHashSegment=()=>{const hash=location.hash.slice(1).split('?')[0];if(hash==='enrollments')segment='matriculas';else if(hash==='schedule')segment='horario';};
  applyHashSegment();
  window.addEventListener('hashchange',()=>{applyHashSegment();render(true);document.querySelector('.student-view h1')?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(pollTimer);}else{useProfileServerControls();autoRefresh();schedulePoll();}});
  window.addEventListener('online',autoRefresh);
  window.addEventListener('offline',()=>{offline=true;render();});
  huella=data?.huella||null;
  if(data){lastSuccess=cachedAt||Date.now();render();schedulePoll();if(cachedAt)checkChanges();}else{render();refresh();}
}
function render(force=false){
  if(!force&&editing())return;
  const key=route(),title=key==='notifications'?'Mis avisos':tabs.find(t=>t[0]===key)[1],view=document.querySelector('.student-view');
  if(!view)return;
  if(data)rememberStudentIdentity(data.alumno);
  const previousScroll=view.querySelector('.view__scroll');if(previousScroll&&lastScreen)scrollPositions.set(lastScreen,previousScroll.scrollTop);
  const screen=key==='studies'?`${key}:${segment}`:key;view.classList?.toggle('repaint-quiet',screen===lastScreen);lastScreen=screen;
  document.querySelectorAll('#bottom-nav .tab-item').forEach(tab=>{const active=tab.dataset.route===key;tab.classList.toggle('active',active);if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});
  moveTabIndicator();
  const content=key==='notifications'?studentNoticesMarkup():key==='home'?home():key==='profile'?profile():key==='attendance'?attendance():key==='pagos'?pagos():studies();
  view.innerHTML=`${header(title)}<div class="view__scroll"><div class="large-title"><div class="large-title__kicker">${key==='home'?esc(dateLima()):'MI ESPACIO ESTUDIANTIL'}</div><div class="large-title__row"><h1 class="large-title__text">${title}</h1><span class="sa-account-chip">Alumno</span></div></div><div class="view__content"><div class="page sa-page">
    ${error?`<div class="inline-alert inline-alert--danger sa-alert" role="alert">${icon('offline')}<div><strong>No se pudieron actualizar tus datos</strong><p>${esc(error)}</p><button type="button" class="ios-btn ios-btn-secondary ios-btn--sm" id="student-retry">Reintentar</button></div></div>`:''}
    ${offline?`<div class="sa-offline" role="status">Sin conexión. ${data?'Estás viendo la última consulta de esta sesión; los datos pueden haber cambiado.':'Conéctate a la red del servidor para consultar tus datos.'}</div>`:''}
    ${data&&['studies','pagos'].includes(key)?periodSelector():''}
    ${!data&&!['studies','attendance','profile','notifications'].includes(key)?placeholder():content}
    <div class="sa-sync-note">${data?'Datos de tu cuenta de intranet':'Sin datos disponibles'} · ${loading?'Actualizando…':lastSuccess?'Actualizado '+new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'}).format(lastSuccess):'IDEAS'}</div>
  </div></div></div>`;
  saveStudentUi({segment,period});
  const scroller=view.querySelector('.view__scroll'),bar=view.querySelector('.nav-bar');
  try{window.ideasSeasonDecorate?.();}catch{}scroller.scrollTop=scrollPositions.get(screen)||0;
  const updateBar=()=>{bar.classList.toggle('is-scrolled',scroller.scrollTop>2);bar.classList.toggle('is-collapsed',scroller.scrollTop>58);};updateBar();
  scroller.addEventListener('scroll',updateBar,{passive:true});
  view.querySelector('h1')?.setAttribute('tabindex','-1');
  view.querySelector('#student-period')?.addEventListener('change',event=>{period=event.target.value;searchQuery='';scrollPositions.clear();lastScreen='';render();document.getElementById('student-period')?.focus({preventScroll:true});});
  const search=view.querySelector('#student-course-search');if(search){search.value=searchQuery;search.addEventListener('input',()=>{searchQuery=search.value;filterCourses();});filterCourses();}
  view.querySelectorAll('[data-schedule-day]').forEach(button=>button.addEventListener('click',()=>{scheduleDay=button.dataset.scheduleDay;render();}));
  view.querySelector('#student-refresh')?.addEventListener('click',refresh);view.querySelector('#student-retry')?.addEventListener('click',refresh);
  view.querySelectorAll('[data-study-segment]').forEach(button=>button.addEventListener('click',()=>{segment=button.dataset.studySegment;render();}));
  if(key==='home')view.querySelectorAll('a[href="#studies"],a[href="#enrollments"],a[href="#schedule"],a[href="#pagos"]').forEach(link=>link.addEventListener('click',()=>{period=link.getAttribute('href')==='#pagos'?'*':defaultPeriod(data);if(link.getAttribute('href')==='#studies')segment='cursos';scheduleDay='all';scrollPositions.clear();lastScreen='';}));
  view.querySelector('#student-logout')?.addEventListener('click',confirmLogout);
  view.querySelector('#student-server-settings')?.addEventListener('click',()=>{try{openStudentServerSettings();}catch(error){showToast(error.message||'No se pudo abrir la configuración del servidor.','warning');}});
  bindAttendance(view,{onIdle:idle,onCalendar:()=>render(true),onSync:()=>syncMarks(true),onQueued:()=>{showToast('Sin conexión: tu marca quedó guardada y se enviará sola al volver la red.','warning',5000);render(true);},onMarked:result=>{showToast(result.ya_registrada?'Tu asistencia de esta clase ya estaba registrada.':`Asistencia registrada: ${result.curso} (${result.estado==='tardanza'?'tardanza':'presente'})`,result.estado==='tardanza'?'warning':'success');refresh({silent:true});}});
  bindStudentPushControls(view);
  bindStudentWebLogin(view,{onIdle:idle});
  bindStudentSettings(view,{onIdle:idle,onProfile:(result,message)=>{if(!data||!studentSession())return;if('telefono' in result)data.alumno.telefono=result.telefono;if('email' in result)data.alumno.email=result.email;saveStudentCache(data);render(true);showToast(message||'Datos actualizados correctamente','success');},onDni:result=>{if(!data||!studentSession())return;data.alumno.dni=result.dni;rememberStudentIdentity(data.alumno);saveStudentCache(data);forgetStudentBiometric();render(true);showToast('DNI actualizado. Úsalo para ingresar desde ahora; vuelve a activar la huella si la usabas.','success');},onBiometric:message=>{render(true);showToast(message,'success');},onPassword:()=>{data=null;clearStudentSession();try{sessionStorage.setItem('ideas-login-type','alumno');sessionStorage.setItem('ideas-student-login-notice','Contraseña actualizada. Ingresa con tu nueva contraseña de intranet.');}catch{}location.hash='#login';location.reload();}});
}
function home(){
  if(!data)return '';const selected=primaryEnrollment(data),p=selected?{...data.alumno,...selected}:data.alumno,name=data.alumno.nombre||'Estudiante',enrolled=data.matriculas?.some(m=>m.estado==='matriculado');
  const activeIds=new Set((data.matriculas||[]).filter(m=>m.estado==='matriculado').map(m=>String(m.id)));
  const currentCourses=(data.cursos||[]).filter(c=>c.matricula_id!=null?activeIds.has(String(c.matricula_id)):enrolled&&c.periodo===selected?.periodo);
  const today=sortClasses(activeSchedule()).filter(h=>Number(h.dia)===todayNumber());
  return `<section class="hero sa-hero" aria-label="Mi resumen de estudiante"><div><div class="hero__greeting">Qué gusto verte,</div><div class="hero__name">${esc(name.split(' ')[0])}</div><span class="hero__status">${enrolled?'Tu matrícula está registrada':'Tu espacio de estudiante'}</span></div><div class="sa-hero-emblem">${cap}</div></section>
    <div class="section-head"><h2 class="section-head__title">Mi formación</h2><a href="#studies" class="sa-text-link">Ver estudios</a></div>
    ${p.programa?`<a class="ios-card sa-program" href="#enrollments"><span class="sa-program-icon">${cap}</span><div><span class="sa-eyebrow">${esc(p.periodo||'PROGRAMA ACADÉMICO')}</span><h3>${esc(p.programa)}</h3><p>${esc([p.ciclo?'Ciclo '+p.ciclo:'',p.seccion?'Sección '+p.seccion:'',p.turno,label(p.estado||p.matricula_estado)].filter(Boolean).join(' · '))}</p></div>${icon('chevron')}</a>`:
    `<div class="ios-card sa-program"><span class="sa-program-icon">${cap}</span><div><h3>Aún no tienes una matrícula asignada</h3><p>Cuando administración registre tu matrícula en la intranet, aquí aparecerán tu programa, sección y cursos.</p></div></div>`}
    <div class="sa-stats"><a href="#studies" class="stat-tile"><span class="sa-stat-icon">${book}</span><strong>${currentCourses.length}</strong><span>Cursos vigentes</span></a><a href="#schedule" class="stat-tile"><span class="sa-stat-icon">${icon('calendar')}</span><strong>${today.length}</strong><span>Clases de hoy</span></a></div>
    ${attendanceCard()}${nextClassCard()}${payCard()}
    <div class="section-head"><h2 class="section-head__title">Mi día</h2><a href="#schedule" class="sa-text-link">Ver horario</a></div>
    <div class="ios-card ios-card--flush list-group--icons">${today.length?today.slice(0,3).map(classRow).join(''):`<div class="list-row">${rowIcon('calendar','orange')}<span class="list-row__main"><span>${list('horarios').length?'Hoy no tienes clases programadas':'Tu horario aparecerá aquí'}</span><span class="list-row__sub">${list('horarios').length?'Consulta los demás días en Horario.':'Aún no hay clases asignadas a tu cuenta.'}</span></span></div>`}</div>
    <div class="list-header">Accesos rápidos</div><div class="ios-card ios-card--flush list-group--icons"><a class="list-row" href="#profile">${rowIcon('user','blue')}<span class="list-row__main">Mis datos personales</span><span class="list-row__end">${icon('chevron')}</span></a><a class="list-row" href="#enrollments">${rowIcon('doc','orange')}<span class="list-row__main">Mi matrícula y evaluaciones</span><span class="list-row__end">${icon('chevron')}</span></a></div>`;
}
function classRow(h){return `<div class="list-row">${rowIcon('clock','orange')}<span class="list-row__main"><span>${esc(h.curso)}</span><span class="list-row__sub">${esc(h.aula?'Aula '+h.aula:'Aula por confirmar')}</span></span><span class="list-row__end sa-time">${esc(String(h.hora_inicio).slice(0,5))}<small>${esc(String(h.hora_fin).slice(0,5))}</small></span></div>`;}
function studies(){
  const selector=`<div class="segmented sa-segments" role="group" aria-label="Información académica">${[['cursos','Cursos'],['matriculas','Matrícula'],['horario','Horario'],['evaluaciones','Notas']].map(([key,text])=>`<button type="button" class="segmented__btn ${segment===key?'active':''}" data-study-segment="${key}" aria-pressed="${segment===key}">${text}</button>`).join('')}</div>`;
  if(!data)return selector+placeholder();
  if(segment==='cursos')return selector+(list('cursos').length?`<label class="sa-search-label" for="student-course-search">Buscar en mis cursos</label><input id="student-course-search" class="ios-input sa-search" type="search" placeholder="Nombre, código o periodo" autocomplete="off" maxlength="100"><p id="student-course-count" class="sa-caption" role="status" aria-live="polite"></p><div class="section-head"><h2 class="section-head__title">Mis cursos</h2><span class="ios-badge">${list('cursos').length}</span></div><p id="student-search-empty" class="sa-caption" hidden>No hay coincidencias. Prueba con otro nombre o código.</p><div class="ios-card ios-card--flush list-group--icons">${list('cursos').map(c=>`<div class="list-row" data-course-search="${esc(normalizeSearch([c.nombre,c.codigo,c.periodo].join(' ')))}">${rowIcon('doc','blue')}<span class="list-row__main"><span>${esc(c.nombre)}</span><span class="list-row__sub">${esc([c.codigo,c.periodo,c.seccion?'Sección '+c.seccion:''].filter(Boolean).join(' · '))}</span></span><span class="list-row__end">${Number(c.creditos)||0} cr.</span></div>`).join('')}</div>`:empty('Tus cursos, en un solo lugar','Todavía no hay cursos asociados a tu matrícula o sección. No necesitas agregarlos: aparecerán cuando se registren en la intranet.'));
  if(segment==='horario')return selector+schedule();
  if(segment==='evaluaciones')return selector+evaluations();
  return selector+(list('matriculas').length?list('matriculas').map(m=>`<section class="ios-card sa-enrollment"><div class="section-head"><span class="sa-eyebrow">${esc(m.periodo)}</span><span class="chip ${m.estado==='matriculado'?'chip--success':''}">${esc(label(m.estado))}</span></div><h2>${esc(m.programa||'Programa por asignar')}</h2><div class="sa-enrollment-meta">${[m.ciclo?'Ciclo '+m.ciclo:'',m.seccion?'Sección '+m.seccion:'',m.turno].filter(Boolean).map(v=>`<span>${esc(v)}</span>`).join('')}</div>${m.fecha_inicio||m.fecha_fin?`<p class="sa-caption">${[m.fecha_inicio?'Inicio: '+fmtDate(m.fecha_inicio):'',m.fecha_fin?'Fin: '+fmtDate(m.fecha_fin):''].filter(Boolean).map(esc).join(' · ')}</p>`:''}</section>`).join(''):empty('Tu matrícula está pendiente de registro','Tu cuenta de alumno ya funciona. Consulta con administración para que vincule tu matrícula en la intranet.',cap));
}
function evaluations(){
  const notes=list('evaluaciones');
  if(!notes.length)return empty('Aún no tienes evaluaciones publicadas','Cuando se registren tus evaluaciones en la intranet, podrás consultarlas aquí.',icon('chart'));
  const linked=notes.some(n=>String(n.curso||'').trim());
  const legacy=notes.some(n=>!String(n.curso||'').trim());
  const caption=linked?'Notas publicadas por curso y parcial.':'Evaluaciones de tu matrícula.';
  return `<p class="sa-caption">${caption}${legacy?' Las evaluaciones sin curso asociado se muestran tal como están registradas en la intranet.':''}</p>${academicGroups(notes).map(group=>`${groupHeading(group)}<div class="ios-card ios-card--flush list-group--icons">${[...group.items].sort((a,b)=>String(a.curso||'').localeCompare(String(b.curso||''),'es')||Number(a.parcial)-Number(b.parcial)||String(a.fecha).localeCompare(String(b.fecha))).map(n=>{
    const hasGrade=n.nota!==null&&n.nota!==undefined&&String(n.nota).trim()!==''&&Number.isFinite(Number(n.nota));
    const course=String(n.curso||'').trim();
    return `<div class="list-row">${rowIcon('chart','purple')}<span class="list-row__main"><span>${course?esc(course):'Evaluación '+esc(n.parcial)}</span><span class="list-row__sub">${esc([course?'Parcial '+n.parcial:'',fmtDate(n.fecha)].filter(Boolean).join(' · '))}</span></span><span class="list-row__end sa-grade">${hasGrade?esc(Number(n.nota).toLocaleString('es-PE',{maximumFractionDigits:2})):'Pendiente'}${hasGrade?'<small>/20</small>':''}</span></div>`;
  }).join('')}</div>`).join('')}`;
}

function academicGroups(items){
  const groups=new Map();
  for(const item of items){const key=String(item.matricula_id??item.periodo??'');if(!groups.has(key))groups.set(key,{enrollment:(data.matriculas||[]).find(m=>String(m.id)===String(item.matricula_id))||item,items:[]});groups.get(key).items.push(item);}
  return [...groups.values()].sort((a,b)=>(a.enrollment.estado==='matriculado'?0:1)-(b.enrollment.estado==='matriculado'?0:1)||String(b.enrollment.periodo||'').localeCompare(String(a.enrollment.periodo||'')));
}
function groupHeading(group){const m=group.enrollment;return `<div class="sa-academic-context"><strong>${esc([m.periodo,m.ciclo?'Ciclo '+m.ciclo:''].filter(Boolean).join(' · '))}</strong><span>${esc([m.seccion?'Sección '+m.seccion:'',label(m.estado||m.estado_matricula)].filter(Boolean).join(' · '))}</span></div>`;}
function schedule(){
  if(!data)return '';const items=sortClasses(list('horarios'));if(!items.length)return empty('Aún no hay clases programadas','Cuando tu sección tenga un horario registrado en la intranet, aquí verás los días, las horas y las aulas.',icon('calendar'));
  return `<p class="sa-caption">Horario semanal registrado · hora de Lima. Los periodos anteriores se muestran como historial.</p><div class="sa-day-filter" role="group" aria-label="Filtrar horario">${[['all','Semana'],[String(todayNumber()),days[todayNumber()]]].map(([value,text])=>`<button type="button" class="chip" data-schedule-day="${value}" aria-pressed="${scheduleDay===value}">${text}</button>`).join('')}</div>${scheduleDay!=='all'&&!items.some(h=>Number(h.dia)===Number(scheduleDay))?empty('Sin clases este día','Consulta los demás días con el botón Semana.',icon('calendar')):''}`+academicGroups(items).map(group=>`${groupHeading(group)}${[1,2,3,4,5,6,7].map(day=>{const rows=group.items.filter(h=>Number(h.dia)===day);return rows.length&&(scheduleDay==='all'||Number(scheduleDay)===day)?`<div class="list-header">${days[day]}</div><div class="ios-card ios-card--flush list-group--icons">${rows.map(classRow).join('')}</div>`:'';}).join('')}`).join('');
}
function appMarkup(){
  const server=studentServerInfo();
  return `<div class="list-header">Aplicación</div><div class="ios-card ios-card--flush list-group--icons">${server?`<button type="button" id="student-server-settings" class="list-row" aria-haspopup="dialog">${rowIcon('server','teal')}<span class="list-row__main"><span>Servidor</span><span class="list-row__sub">${esc(server.label)}</span></span><span class="list-row__end">${ICON_CHEVRON}</span></button>`:''}<div class="list-row">${rowIcon('info','gray')}<span class="list-row__main">Versión</span><span class="list-row__end tabular">${esc(APP_VERSION)}</span></div></div>`;
}
function profile(){
  if(!data){const session=studentSession(),name=session?.nombre||'Estudiante';return `<div class="profile-head"><span class="avatar avatar--initials sa-avatar">${esc(initials(name))}</span><h2 class="profile-head__name">${esc(name)}</h2><p class="profile-head__sub">${session?.dni?'DNI '+esc(session.dni):'Estudiante · Instituto IDEAS'}</p></div><div class="ios-card"><p>Conecta con tu intranet para consultar y editar tus datos personales. Puedes revisar el servidor o cerrar sesión desde aquí.</p></div>${studentWebLoginMarkup()}${studentPushSettingsMarkup()}${appMarkup()}${logoutMarkup()}`;}
  const p=data.alumno,name=`${p.nombre} ${p.apellido}`;
  return `<div class="profile-head"><span class="avatar avatar--initials sa-avatar">${esc(initials(name))}</span><h2 class="profile-head__name">${esc(name)}</h2><p class="profile-head__sub">${esc(p.programa||'Estudiante · Instituto IDEAS')}</p></div>
    ${studentProfileDataMarkup(p)}${studentSettingsMarkup(p)}${studentWebLoginMarkup()}${studentPushSettingsMarkup()}${appMarkup()}${logoutMarkup()}`;
}
function logoutMarkup(){return `<div class="ios-card ios-card--flush logout-area"><button type="button" class="list-row list-row--destructive sa-logout" id="student-logout">${rowIcon('logout','red')}<span class="list-row__main">Cerrar sesión</span></button></div>`;}
async function refresh({silent=false}={}){
  if(loading||loggingOut||accountBusy()||attendanceBusy()||intranetQrOpen())return;
  if(!studentSession()){data=null;clearStudentSession();try{sessionStorage.setItem('ideas-login-type','alumno');sessionStorage.setItem('ideas-student-login-notice','Tu sesión cambió. Ingresa nuevamente con tu cuenta de intranet.');}catch{}location.hash='#login';location.reload();return;}
  offline=navigator.onLine===false;
  if(offline){if(!data)error='Sin conexión. Conéctate a la red del servidor y vuelve a intentar.';if(!silent)render();return;}
  clearTimeout(pollTimer);
  lastAttempt=Date.now();const request=++generation;
  if(!silent){loading=true;error='';render();}
  let changed=false;
  try{
    const result=await studentRequest('perfil');if(request!==generation)return;
    const before=data?JSON.stringify(data):'';
    data=result;huella=result.huella||huella;
    if(period!=='*'&&!academicPeriods(data).includes(period))period=defaultPeriod(data);
    lastSuccess=Date.now();error='';stale=false;changed=before!==JSON.stringify(data);saveStudentCache(data);
  }catch(e){
    if(request!==generation)return;
    if(!silent)error=e.name==='AbortError'?'La intranet tardó demasiado en responder. Revisa el servidor y tu conexión.':e.message;
  }finally{
    if(request===generation){
      if(!silent)loading=false;
      // Un refresco silencioso solo repinta si llegó algo distinto y el alumno no está editando o marcando.
      if(!silent||changed){if(editing())pendingRender=true;else render();}
      schedulePoll();
    }
  }
}
async function confirmLogout(){
  if(loggingOut||accountBusy())return;
  const choice=await showActionSheet({title:'¿Cerrar sesión?',message:'Podrás volver a entrar con tu contraseña de intranet o con la huella que hayas activado.',actions:[{label:'Cerrar sesión',value:'logout',style:'destructive'}]});
  if(choice==='logout')logout();
}
// Píldora que se desliza hasta la pestaña activa, igual que en la app de trabajadores.
function moveTabIndicator(){
  const nav=document.getElementById('bottom-nav');if(!nav)return;
  let pill=nav.querySelector('.tab-indicator');const first=!pill;
  if(!pill){pill=document.createElement('span');pill.className='tab-indicator';pill.setAttribute('aria-hidden','true');nav.prepend(pill);}
  const place=()=>{const active=nav.querySelector('.tab-item.active');if(!active||!active.offsetWidth){pill.style.opacity='0';return;}pill.style.opacity='1';pill.style.width=`${active.offsetWidth}px`;pill.style.transform=`translateX(${active.offsetLeft}px)`;};
  if(first){pill.classList.add('no-anim');requestAnimationFrame(()=>{place();requestAnimationFrame(()=>pill.classList.remove('no-anim'));});window.addEventListener('resize',place);}else requestAnimationFrame(place);
}
async function logout(){
  if(loggingOut||accountBusy())return;loggingOut=true;generation++;clearTimeout(pollTimer);const button=document.getElementById('student-logout');if(button){button.disabled=true;button.textContent='Cerrando sesión…';}
  try{await studentRequest('salir');}catch{}finally{data=null;clearStudentSession();try{sessionStorage.setItem('ideas-login-type','alumno');}catch{}location.hash='#login';location.reload();}
}

function filterCourses(){
  let visible=0;
  document.querySelectorAll('[data-course-search]').forEach(row=>{const match=matchesSearch([row.dataset.courseSearch],searchQuery);row.hidden=!match;if(match)visible++;});
  const count=document.getElementById('student-course-count');if(count)count.textContent=`${visible} de ${list('cursos').length} cursos`;
  const emptyResult=document.getElementById('student-search-empty');if(emptyResult)emptyResult.hidden=visible>0;
}
function activeSchedule(){
  // Hoy siempre usa las matrículas vigentes, aunque Estudios conserve un periodo histórico.
  return currentEnrollmentSchedule(data,Array.isArray(data?.horarios)?data.horarios:[]);
}
function nextClassCard(){
  const next=nextWeeklyClass(activeSchedule());if(!next)return '';
  const h=next.item;
  return `<a class="ios-card sa-next-class ${next.active?'sa-next-class--active':''}" href="#schedule"><div class="sa-next-head"><span class="sa-eyebrow">${next.active?'EN HORARIO AHORA':'PRÓXIMA CLASE SEMANAL'}</span><span>${icon('chevron')}</span></div><h2>${esc(h.curso)}</h2><p>${esc(days[Number(h.dia)])} · ${esc(String(h.hora_inicio).slice(0,5))}–${esc(String(h.hora_fin).slice(0,5))}</p><div>${esc(h.aula?'Aula '+h.aula:'Aula por confirmar')} · ${esc(h.periodo)}</div><small>Según el horario semanal de tu matrícula, hora de Lima.</small></a>`;
}

// ── Pagos: cronograma de matrícula y pensiones (solo lectura, mismos saldos que la intranet) ──
const money=value=>'S/ '+Number(value||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));return m?`${m[3]}/${m[2]}/${m[1]}`:'Sin fecha';};
const payLabels={pagado:'Pagado',revision:'En revisión',vencido:'Vencido',parcial:'Pago parcial',pendiente:'Pendiente'};
const payIcons={pagado:['circlecheck','green'],revision:['clock','blue'],vencido:['circlealert','red'],parcial:['clock','orange'],pendiente:['calendar','orange']};
const payState=paymentState,payTotals=paymentTotals;
function payRow(o){
  const state=payState(o),[symbol,color]=payIcons[state];
  const detail=state==='pagado'?'Cuota cancelada':state==='revision'?'Comprobante en revisión':Number(o.pagado)>0?`Pagado ${money(o.pagado)} de ${money(paymentNet(o))}`:'Por pagar';
  const sub=[detail,Number(o.descuento)>0?`Descuento ${money(o.descuento)}`:'',state!=='pagado'?'Vencimiento: '+fmtDate(o.vence):'',period==='*'?o.periodo:''].filter(Boolean).join(' · ');
  return `<div class="list-row">${rowIcon(symbol,color)}<span class="list-row__main"><span>${esc(o.descripcion)}</span><span class="list-row__sub">${esc(sub)}</span></span><span class="list-row__end sa-pay-amount"><b>${money(state==='pagado'?paymentNet(o):o.saldo)}</b><small class="sa-pay-badge sa-pay-badge--${state}">${payLabels[state]}</small></span></div>`;
}
function payCard(){
  if(!data||!Array.isArray(data.pagos)||!data.pagos.length)return '';
  const {overdue,next,review,debt}=payTotals(data.pagos);
  if(debt<=0)return `<a class="ios-card sa-next-class" href="#pagos"><div class="sa-next-head"><span class="sa-eyebrow">MIS PAGOS</span><span>${icon('chevron')}</span></div><h2>Estás al día</h2><p>No tienes cuotas pendientes.</p></a>`;
  return `<a class="ios-card sa-next-class ${overdue.length?'sa-pay-card--due':''}" href="#pagos"><div class="sa-next-head"><span class="sa-eyebrow">SALDO REGISTRADO</span><span>${icon('chevron')}</span></div><h2>${money(debt)}</h2><p>${overdue.length?`${overdue.length} cuota${overdue.length>1?'s':''} vencida${overdue.length>1?'s':''}`:next?`Próximo vencimiento: ${fmtDate(next.vence)}`:'Pendiente de confirmación'}</p><small>Todos los periodos${review.length?` · ${review.length} cuota${review.length>1?'s':''} en revisión`:''}</small></a>`;
}
function pagos(){
  if(!data)return '';
  if(!(data.pagos||[]).length&&!(data.pagos_historial||[]).length)return empty('Aún no hay pagos registrados','Cuando administración genere tu matrícula y tus pensiones, aquí verás tu cronograma y tus pagos.',icon('doc'));
  const items=list('pagos'),{overdue,next,review,debt}=payTotals(items);
  const summary=items.length?`<section class="ios-card sa-pay-summary" aria-label="Resumen de pagos"><span class="sa-eyebrow">SALDO REGISTRADO</span><strong class="sa-pay-total ${overdue.length?'is-due':''}">${money(debt)}</strong><p>${overdue.length?`${overdue.length} cuota${overdue.length>1?'s':''} vencida${overdue.length>1?'s':''}. `:''}${next?`Próximo vencimiento: ${fmtDate(next.vence)}.`:debt<=0?'Estás al día con tus pagos.':''}</p>${review.length?`<p class="sa-payment-review">${review.length} cuota${review.length>1?'s':''} con comprobante en revisión, incluida${review.length>1?'s':''} en este saldo hasta su aprobación. No vuelvas a pagarla${review.length>1?'s':''} mientras se revisa${review.length>1?'n':''}.</p>`:''}</section>`:'';
  const schedule=items.length?`<div class="list-header">Cronograma de pagos</div><div class="ios-card ios-card--flush list-group--icons">${items.map(payRow).join('')}</div>`:empty('Sin cuotas en este periodo','Elige otro periodo para ver su cronograma.',icon('calendar'));
  const history=inPeriod(Array.isArray(data.pagos_historial)?data.pagos_historial:[],period);
  const historyStates={Pagado:['circlecheck','green'],'En revision':['clock','blue'],Rechazado:['circlex','red'],Anulado:['circlex','gray']};
  const historyBlock=history.length?`<div class="list-header">Movimientos de pago</div><div class="ios-card ios-card--flush list-group--icons">${history.map(h=>{const [symbol,color]=historyStates[h.estado]||['doc','gray'];return `<div class="list-row">${rowIcon(symbol,color)}<span class="list-row__main"><span>${esc(h.conceptos||h.codigo)}</span><span class="list-row__sub">${esc([fmtDate(h.fecha),h.metodo,h.estado==='En revision'?'En revisión':h.estado==='Rechazado'&&h.motivo_rechazo?'Rechazado: '+h.motivo_rechazo:h.estado,period==='*'?h.periodo:''].filter(Boolean).join(' · '))}</span></span><span class="list-row__end sa-pay-amount"><b>${money(h.total)}</b></span></div>`;}).join('')}</div>`:'';
  return `${summary}${schedule}${historyBlock}<p class="sa-caption">Los pagos se registran desde la intranet o en administración. Aquí solo puedes consultarlos.</p>`;
}

// ── Asistencia ──
function attendance(){
  return attendanceMarkup(data)+(data?'':placeholder());
}
function attendanceCard(){
  if(!data)return '';
  const due=pendingMarks(data);
  if(!due.length)return '';
  const c=due[0];
  return `<a class="ios-card sa-next-class sa-next-class--active" href="#attendance"><div class="sa-next-head"><span class="sa-eyebrow">MARCA TU ASISTENCIA</span><span>${icon('chevron')}</span></div><h2>${esc(c.curso)}</h2><p>${esc(c.hora_inicio)}–${esc(c.hora_fin)}${c.aula?' · Aula '+esc(c.aula):''}</p><small>Escanea el QR de la pantalla del instituto.</small></a>`;
}
