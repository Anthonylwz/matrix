import {staffSession,staffRequest,staffLogout,forgetStaffSession} from './staff-api.js';
import {initTheme,getThemePreference,setThemePreference} from './theme.js';
import {icon} from './icons.js';
import {showToast} from './utils.js';
import {useProfileServerControls,studentServerInfo,openStudentServerSettings} from './student-server.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'S/ '+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeRange=(start,end)=>[start,end].map(value=>typeof value==='string'&&/^\d{2}:\d{2}/.test(value)?value.slice(0,5):'—').join('–');
const days=['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const roleNames={superadmin:'Superadministrador',admin:'Administrador',supervisor:'Supervisor',readonly:'Consulta',administrador:'Administrador',docente:'Docente',secretaria:'Secretaría'};
let root,panel,sequence=0,controller,scanner=null,timer=null,selectedCourse=null,offset=0,searchPage=1,studentQuery='',teamQuery='',expiryTimer=null,readerGeneration=0;
const route=()=>location.hash.slice(1).split('?')[0]||'home';
const empty=text=>`<p class="staff-empty">${esc(text)}</p>`;
const table=(heads,rows)=>`<div class="staff-table"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function stopCamera(){readerGeneration++;scanner?.stop();scanner=null;}
function tabList(){
 const list=[['home','Hoy','calendar']];
 if(panel?.identidad.origen==='asistencia'){
  if(panel.permisos?.estudiantes)list.push(['students','Alumnos','graduation-cap']);
  if(panel.permisos?.trabajadores)list.push(['team','Equipo','users']);
 }else if(panel?.identidad.rol==='docente'){list.push(['courses','Cursos','book'],['schedule','Horario','clock']);}
 list.push(['profile','Perfil','user']);return list;
}
function chrome(){
 const nav=document.getElementById('bottom-nav');nav.hidden=false;nav.setAttribute('aria-label','Secciones de tu cuenta');
 nav.innerHTML=tabList().map(([key,label,glyph])=>`<a class="tab-item ${route()===key?'active':''}" data-route="${key}" href="#${key}" ${route()===key?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span></a>`).join('');
}
function content(title,body){
 chrome();root.innerHTML=`<header class="staff-header"><div><span class="staff-eyebrow">${esc(roleNames[panel?.identidad.rol]||'Cuenta institucional')} · ${panel?.identidad.origen==='intranet'?'Intranet':'Asistencia'}</span><h1 tabindex="-1">${esc(title)}</h1></div><button class="staff-refresh" type="button" aria-label="Actualizar datos">${icon('refresh')}</button></header>${body}`;
 root.querySelector('.staff-refresh')?.addEventListener('click',render);
}
async function load(action,values={}){
 controller?.abort();const current=new AbortController();controller=current;const stamp=++sequence;
 try{const value=await staffRequest(action,values,{signal:current.signal});if(stamp!==sequence)throw Object.assign(new Error('Consulta reemplazada.'),{cancelled:true});return value;}
 catch(e){if(current.signal.aborted||stamp!==sequence)e.cancelled=true;throw e;}
}
function home(){
 const stats=Object.entries(panel.resumen||{}).map(([key,value])=>`<article class="ios-card staff-stat"><span>${esc({trabajadores_activos:'Trabajadores activos',marcaciones_hoy:'Marcaciones hoy',alumnos:'Alumnos activos',secciones:'Secciones activas'}[key]||key)}</span><strong>${esc(value)}</strong></article>`).join('');
 const courses=panel.cursos||[],marks=panel.marcaciones||[];
 content('Hola, '+String(panel.identidad.nombre).split(' ')[0],`<p class="staff-subtitle">Tu información y accesos según los permisos de tu cuenta.</p>${stats?`<section class="staff-stats">${stats}</section>`:''}${panel.identidad.rol==='docente'?`<h2>Mis cursos</h2>${courseCards(courses)}`:''}${panel.permisos?.estudiantes?`<a href="#students" class="ios-card staff-shortcut">${icon('graduation-cap')}<span>Consultar alumno<small>Busca por nombre o DNI y abre su ficha</small></span>${icon('chevron-right')}</a>`:''}${panel.permisos?.trabajadores?`<a href="#team" class="ios-card staff-shortcut">${icon('qr')}<span>Equipo y fotochecks<small>Consulta trabajadores o escanea su credencial</small></span>${icon('chevron-right')}</a>`:''}${panel.permisos?.asistencia?`<h2>Marcaciones de hoy</h2>${marks.length?table(['Trabajador','Entrada','Salida','Estado'],marks.map(m=>[esc(m.nombres+' '+m.apellidos),esc(m.hora_entrada||'—'),esc(m.hora_salida||'—'),esc(m.estado)])):empty('No hay marcaciones registradas hoy.')}`:''}${!stats&&!courses.length&&!panel.permisos?.trabajadores&&!panel.permisos?.estudiantes?empty('Tu cuenta está activa. Las funciones disponibles dependen de los permisos asignados en el sistema.'):''}`);
 bindCourses();
}
function courseCards(courses){return courses.length?`<div class="staff-list">${courses.map(c=>`<button class="ios-card staff-course" data-course="${Number(c.id)}"><span>${esc(c.nombre)}</span><small>${esc(c.seccion)} · ${esc(c.periodo)} · ${esc(c.turno)}</small>${icon('chevron-right')}</button>`).join('')}</div>`:empty('No tienes cursos asignados vigentes. Administración debe registrar tu asignación.');}
function bindCourses(){root.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{selectedCourse=Number(b.dataset.course);offset=0;if(route()==='courses')render();else location.hash='#courses';}));}
function searchForm(value='',label='DNI o nombre'){return `<form id="staff-search" class="staff-search"><label for="staff-query">${esc(label)}</label><div><input id="staff-query" class="ios-input" name="q" maxlength="100" value="${esc(value)}" placeholder="Buscar…"><button class="ios-btn ios-btn-primary" type="submit">Buscar</button></div></form>`;}
async function students(query=studentQuery,page=searchPage){
 const data=await load('buscar_alumnos',{q:query,page});searchPage=data.page;studentQuery=query;
 content('Alumnos',searchForm(query)+`<p class="staff-subtitle">${Number(data.total)} resultado(s) · página ${Number(data.page)} de ${Number(data.pages)}</p><div class="staff-list">${data.items.map(a=>`<button class="ios-card staff-course" data-student="${Number(a.id)}"><span>${esc(a.nombre+' '+a.apellido)}</span><small>${esc(a.dni)} · ${esc(a.programa||'Sin programa')} · ${esc(a.matricula_estado||'Sin matrícula')}</small>${panel.permisos.ficha?icon('chevron-right'):''}</button>`).join('')||empty('No se encontraron alumnos.')}<div class="staff-actions"><button class="ios-btn ios-btn-secondary" id="staff-prev" ${data.page<=1?'disabled':''}>Anterior</button><button class="ios-btn ios-btn-secondary" id="staff-next" ${data.page>=data.pages?'disabled':''}>Siguiente</button></div></div>`);
 root.querySelector('#staff-search').addEventListener('submit',e=>{e.preventDefault();perform(()=>students(new FormData(e.target).get('q'),1));});
 root.querySelector('#staff-prev').onclick=()=>perform(()=>students(query,searchPage-1));root.querySelector('#staff-next').onclick=()=>perform(()=>students(query,searchPage+1));
 root.querySelectorAll('[data-student]').forEach(b=>b.onclick=()=>panel.permisos.ficha?perform(()=>student(Number(b.dataset.student))):showNotice('Tu permiso permite consultar el padrón; la ficha ampliada requiere autorización.'));
}
async function student(id){const data=await load('ficha_alumno',{id});paintStudent(data);}
function paintStudent(data,period=null){
 const periods=[...new Set(data.matriculas.map(m=>m.periodo).filter(Boolean))];period=period??periods[0]??'*';const rows=list=>(list||[]).filter(r=>period==='*'||r.periodo===period);
 const obligations=rows(data.finanzas?.obligaciones),balance=obligations.reduce((n,o)=>n+Math.round(Number(o.saldo)*100),0)/100;
 content('Ficha del alumno',`<button class="staff-back" id="staff-return">${icon('chevron-left')} Volver a buscar</button><h2>${esc(data.alumno.nombre+' '+data.alumno.apellido)}</h2><p class="staff-subtitle">DNI ${esc(data.alumno.dni)}</p><label class="staff-label" for="staff-period">Periodo académico</label><select class="ios-input" id="staff-period">${periods.map(p=>`<option value="${esc(p)}" ${p===period?'selected':''}>${esc(p)}</option>`).join('')}<option value="*" ${period==='*'?'selected':''}>Todos los periodos</option></select>${data.finanzas?`<article class="ios-card staff-balance"><span>Saldo pendiente del periodo</span><strong>${money(balance)}</strong><small>Los conceptos anulados se excluyen. Los comprobantes en revisión siguen pendientes de validación.</small></article>`:empty('Tu cuenta no tiene permiso para consultar finanzas.')}<details class="ios-card staff-detail"><summary>Datos de contacto</summary><p>${esc(data.alumno.email||'Correo sin registrar')}</p><p>${esc(data.alumno.telefono||'Teléfono sin registrar')}</p></details><details class="ios-card staff-detail"><summary>Matrículas</summary>${table(['Periodo','Programa','Sección','Estado'],rows(data.matriculas).map(m=>[esc(m.periodo),esc(m.programa),esc(m.seccion),esc(m.estado)]))}</details><details class="ios-card staff-detail"><summary>Cursos y horarios</summary>${table(['Curso','Sección'],rows(data.cursos).map(c=>[esc(c.nombre),esc(c.seccion)]))}${table(['Día','Hora','Curso / aula'],rows(data.horarios).map(h=>[esc(days[Number(h.dia)]||'—'),esc(timeRange(h.hora_inicio,h.hora_fin)),esc(h.curso+' · '+(h.aula||'—'))]))}</details><details class="ios-card staff-detail"><summary>Notas</summary>${table(['Curso','Parcial','Nota / 20'],rows(data.evaluaciones).map(n=>[esc(n.curso||'Evaluación'),esc(n.parcial),esc(n.nota)]))}</details>${data.finanzas?`<details class="ios-card staff-detail" open><summary>Deudas y pagos</summary>${table(['Concepto','Vence','Saldo','Estado'],obligations.map(o=>[esc(o.descripcion),esc(o.vence||'—'),money(o.saldo),esc(o.estado)]))}<p class="staff-subtitle">Los cobros y comprobantes se gestionan en la intranet.</p></details>`:''}<details class="ios-card staff-detail"><summary>Asistencias recientes</summary><p class="staff-subtitle">Registros generales, sin filtro de periodo.</p>${table(['Fecha','Curso','Estado'],(data.asistencia?.historial||[]).map(a=>[esc(a.fecha),esc(a.curso),esc(a.estado)]))}</details>`);
 root.querySelector('#staff-return').onclick=()=>perform(()=>students());root.querySelector('#staff-period').onchange=e=>paintStudent(data,e.target.value);
}
async function team(query=teamQuery){
 const data=await load('trabajadores',{q:query});teamQuery=query;
 content('Equipo y credenciales',`<p class="staff-subtitle">El fotocheck identifica al titular. No registra asistencia ni abre una sesión.</p><button class="ios-btn ios-btn-primary" id="staff-scan">${icon('qr')} Escanear fotocheck</button>${searchForm(query,'Nombre, DNI o código')}<div class="staff-list">${data.items.map(w=>`<article class="ios-card staff-person"><strong>${esc(w.nombres+' '+w.apellidos)}</strong><p>${esc(w.codigo_interno)} · ${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')}</p><small>${esc(w.estado)}</small></article>`).join('')||empty('Sin coincidencias.')}</div>`);
 root.querySelector('#staff-search').onsubmit=e=>{e.preventDefault();perform(()=>team(new FormData(e.target).get('q')));};root.querySelector('#staff-scan').onclick=startCardReader;
}
async function startCardReader(){
 stopCamera();const generation=readerGeneration;let lookupPending=false;
 content('Leer fotocheck',`<button class="staff-back" id="staff-close-scan">${icon('chevron-left')} Volver al equipo</button><div class="staff-camera"><video id="staff-video" playsinline muted autoplay></video></div><p id="staff-camera-status" role="status">Abriendo cámara…</p><form id="staff-code-form"><label for="staff-code">También puedes pegar el enlace del QR</label><input class="ios-input" id="staff-code" maxlength="500"><button type="submit" class="ios-btn ios-btn-secondary">Consultar credencial</button></form>`);
 root.querySelector('#staff-close-scan').onclick=()=>{stopCamera();perform(()=>team());};
 const lookup=async code=>{if(lookupPending||generation!==readerGeneration)return;lookupPending=true;stopCamera();await perform(async()=>{const result=await load('leer_credencial',{codigo:code});const w=result.trabajador;content('Credencial validada',`<article class="ios-card staff-person"><span class="staff-eyebrow">Trabajador activo · Validado por el servidor</span><h2>${esc(w.nombres+' '+w.apellidos)}</h2><p>${esc(w.codigo_interno)} · DNI ${esc(w.dni)}</p><p>${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')}</p><p>${esc(w.email||'Correo sin registrar')}</p><p>${esc(w.telefono||'Teléfono sin registrar')}</p></article><button class="ios-btn ios-btn-secondary" id="staff-scan-again">Escanear otra credencial</button>`);root.querySelector('#staff-scan-again').onclick=startCardReader;});};
 root.querySelector('#staff-code-form').onsubmit=e=>{e.preventDefault();lookup(root.querySelector('#staff-code').value.trim());};
 try{const {QRScannerController}=await import('./scanner.js');if(generation!==readerGeneration||!root.querySelector('#staff-video'))return;const current=new QRScannerController(root.querySelector('#staff-video'),lookup,error=>{const status=root.querySelector('#staff-camera-status');if(status&&generation===readerGeneration)status.textContent=current.getFriendlyErrorMessage(error);});scanner=current;const result=await current.start();if(generation!==readerGeneration||scanner!==current){current.stop();return;}const status=root.querySelector('#staff-camera-status');if(status&&!result.cancelled)status.textContent=result.success?'Apunta al QR del fotocheck.':(result.message||'No se pudo abrir la cámara. Revisa su permiso o pega el enlace del QR.');}catch{const status=root.querySelector('#staff-camera-status');if(status&&generation===readerGeneration)status.textContent='No se pudo abrir la cámara. Revisa su permiso o pega el enlace del QR.';}
}
function courses(){
 const course=(panel.cursos||[]).find(c=>Number(c.id)===selectedCourse);
 if(!course){content('Mis cursos',courseCards(panel.cursos||[]));bindCourses();return;}
 const students=panel.alumnos||[],notes=panel.notas||[];
 content(course.nombre,`<button class="staff-back" id="staff-course-back">${icon('chevron-left')} Todos mis cursos</button><p class="staff-subtitle">${esc(course.seccion)} · ${esc(course.periodo)} · ${esc(course.turno)}</p><h2>Alumnos y notas publicadas</h2>${students.length?table(['Alumno','Notas por parcial'],students.map(a=>[esc(a.apellido+', '+a.nombre),notes.filter(n=>Number(n.matricula_curso_id)===Number(a.id)).map(n=>`<span class="staff-grade">P${esc(n.parcial)}: ${esc(n.nota)}</span>`).join(' ')||'Sin notas publicadas'])):empty('No hay alumnos matriculados en este curso.')}<div class="staff-actions"><button class="ios-btn ios-btn-secondary" id="staff-course-prev" ${offset===0?'disabled':''}>Anterior</button><button class="ios-btn ios-btn-secondary" id="staff-course-next" ${panel.pagina?.siguiente==null?'disabled':''}>Siguiente</button></div><h2>Asistencias recientes</h2>${table(['Fecha','Alumno','Estado'],(panel.asistencias||[]).map(a=>{const u=students.find(s=>Number(s.id)===Number(a.matricula_curso_id));return [esc(a.fecha),esc(u?u.apellido+', '+u.nombre:'—'),esc(a.estado)];}))}<p class="staff-subtitle">Consulta de los cursos que tienes asignados. El registro y la edición académica se gestionan en la intranet.</p>`);
 root.querySelector('#staff-course-back').onclick=()=>{selectedCourse=null;offset=0;render();};root.querySelector('#staff-course-prev').onclick=()=>{offset=Math.max(0,offset-100);render();};root.querySelector('#staff-course-next').onclick=()=>{offset=panel.pagina.siguiente;render();};
}
function schedule(){content('Mi horario',(panel.horarios||[]).length?table(['Día','Hora','Curso / sección','Aula'],panel.horarios.map(h=>[esc(days[Number(h.dia)]||'—'),esc(timeRange(h.hora_inicio,h.hora_fin)),esc(h.curso+' · '+h.seccion),esc(h.aula||'Sin aula')])):empty('No tienes bloques de horario asignados.'));}
function profile(){
 const u=panel.identidad,server=studentServerInfo();
 content('Perfil',`<article class="ios-card staff-person"><h2>${esc(u.nombre)}</h2><p>${esc(roleNames[u.rol]||u.rol)} · ${u.origen==='intranet'?'Intranet':'Asistencia'}</p>${u.dni?`<p>DNI ${esc(u.dni)}</p>`:''}<p>${esc(u.email||'Correo sin registrar')}</p>${u.telefono?`<p>${esc(u.telefono)}</p>`:''}</article><h2>Apariencia</h2><div class="ios-card staff-theme">${[['system','Sistema'],['light','Claro'],['dark','Oscuro']].map(([key,label])=>`<button class="ios-btn ios-btn-secondary" data-staff-theme="${key}" aria-pressed="${getThemePreference()===key}">${icon(key==='dark'?'moon':key==='light'?'sun':'smartphone')} ${label}</button>`).join('')}</div>${server?`<button class="ios-card staff-shortcut" id="staff-server">${icon('server')}<span>Servidor<small>${esc(server.label)}</small></span>${icon('chevron-right')}</button>`:''}<p class="staff-subtitle">La sesión de este panel requiere conexión y vence a las 8 horas. Los cambios de rol, contraseña o permisos se comprueban en el servidor.</p><button class="ios-btn ios-btn-secondary" id="staff-logout">${icon('logout')} Cerrar sesión</button>`);
 root.querySelectorAll('[data-staff-theme]').forEach(b=>b.onclick=()=>{setThemePreference(b.dataset.staffTheme);profile();});root.querySelector('#staff-server')?.addEventListener('click',openStudentServerSettings);root.querySelector('#staff-logout').onclick=()=>staffLogout().catch(()=>{});
}
function showNotice(message){content('Aviso',`<p class="staff-empty" role="status">${esc(message)}</p><button class="ios-btn ios-btn-secondary" id="staff-retry">Volver</button>`);root.querySelector('#staff-retry').onclick=render;}
function expirePanel(){
 sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);panel=null;forgetStaffSession();
 root.innerHTML='<h1>Sesión finalizada</h1>'+empty('Tu sesión venció o tus permisos cambiaron. Vuelve a ingresar.')+'<button id="staff-login" class="ios-btn ios-btn-primary">Iniciar sesión</button>';
 const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';root.querySelector('#staff-login').onclick=()=>location.reload();
}
function handleAccountChange(event){
 if((event.key!==null&&event.key!=='ideas-personal-session:v1')||event.oldValue===event.newValue)return;
 sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);panel=null;
 root.innerHTML=empty('La cuenta cambió. Abriendo la sesión actual…');const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';location.reload();
}
function scheduleSessionExpiry(){
 clearTimeout(expiryTimer);const session=staffSession();if(!session){expirePanel();return;}
 expiryTimer=setTimeout(()=>{if(staffSession())scheduleSessionExpiry();else expirePanel();},Math.max(1,session.expires-Date.now()+20));
}
async function perform(action){try{await action();}catch(e){if(e.cancelled)return;if(!staffSession()||e.status===401){expirePanel();return;}showNotice(e.message||'No se pudo consultar el servidor.');}}
async function render(){
 stopCamera();clearTimeout(timer);root.innerHTML='<p class="staff-empty" role="status">Consultando tu panel…</p>';
 await perform(async()=>{try{panel=await load('panel',{curso:route()==='courses'?selectedCourse:null,offset});}catch(e){if(e.status!==404||route()!=='courses'||selectedCourse===null)throw e;selectedCourse=null;offset=0;panel=await load('panel',{curso:null,offset:0});showToast('El curso ya no está disponible en tus asignaciones.','info');}const allowed=tabList().map(t=>t[0]);if(!allowed.includes(route())){location.hash='#home';return;}
  if(route()==='students')await students();else if(route()==='team')await team();else if(route()==='courses')courses();else if(route()==='schedule')schedule();else if(route()==='profile')profile();else home();
 });
 if(!document.hidden)timer=setTimeout(()=>{if(route()==='home')render();},60000);
}
export async function initStaffApp(){
 initTheme();useProfileServerControls();document.body.classList.add('student-mode','staff-mode');document.body.classList.remove('no-bottom-nav');document.getElementById('ios-install-banner')?.remove();
 if('serviceWorker' in navigator&&location.hostname!=='appassets.androidplatform.net')navigator.serviceWorker.ready.then(reg=>{
  if(reg.scope!==new URL('../',import.meta.url).href)return;let announced=false;
  const announce=()=>{if(announced||!navigator.serviceWorker.controller)return;announced=true;showToast('Hay una versión nueva. Cierra todas las pestañas de esta app y vuelve a abrirla para actualizar.','info',12000);};
  if(reg.waiting)announce();const watch=()=>{const worker=reg.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')announce();});};reg.addEventListener('updatefound',watch);watch();
 }).catch(()=>{});
 const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('../css/staff-app.css?v=1',import.meta.url).href;document.head.append(style);
 document.getElementById('app-view').innerHTML='<section class="view view--tab student-view staff-view"></section>';root=document.querySelector('.staff-view');
 window.addEventListener('storage',handleAccountChange);window.addEventListener('hashchange',render);document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();clearTimeout(timer);controller?.abort();}else render();});window.addEventListener('online',render);window.addEventListener('beforeunload',stopCamera);
 window.__androidBack=()=>{if(scanner){stopCamera();render();return 'handled';}if(route()!=='home'){location.hash='#home';return 'handled';}return 'exit';};
 scheduleSessionExpiry();await render();
}
