import {phoneChatMarkup} from './contact-links.js';
import {personalWebLoginMarkup,bindPersonalWebLogin,handlePersonalQrBack,personalQrOpen} from './personal-web-login.js';
import {staffSession,staffRequest,staffLogout,forgetStaffSession} from './staff-api.js';
import {initTheme,getThemePreference,setThemePreference} from './theme.js';
import {icon,rowIcon} from './icons.js';
import {showToast,showActionSheet,APP_VERSION} from './utils.js';
import {useProfileServerControls,studentServerInfo,openStudentServerSettings} from './student-server.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'S/ '+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeRange=(start,end)=>[start,end].map(value=>typeof value==='string'&&/^\d{2}:\d{2}/.test(value)?value.slice(0,5):'—').join('–');
const days=['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const roleNames={superadmin:'Superadministrador',admin:'Administrador',supervisor:'Supervisor',readonly:'Consulta',administrador:'Administrador',docente:'Docente',secretaria:'Secretaría'};
let root,panel,sequence=0,controller,scanner=null,timer=null,selectedCourse=null,offset=0,searchPage=1,studentQuery='',teamQuery='',expiryTimer=null,readerGeneration=0,selectedStudentId=null,selectedPeriod=null,selectedWorkerId=null;
const PANEL_TTL=30000;
let panelLoadedAt=0,panelOwner=null,panelCourseKey='',viewGeneration=0,keepScroll=false,loggingOut=false;
// Pantallas de resumen que pueden refrescarse en segundo plano sin esqueleto ni salto de desplazamiento.
const QUIET_ROUTES=['home','profile','schedule'];
const clock=value=>new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'}).format(value);
const markChip=state=>/tard/i.test(state||'')?'chip chip--warning':/puntual|registr|complet/i.test(state||'')?'chip chip--success':'chip';
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
 chrome();const role=roleNames[panel?.identidad.rol]||panel?.identidad.rol_nombre||panel?.identidad.rol||'Personal';
 const origin=panel?.identidad.origen==='intranet'?'Intranet':'Asistencia';
 const date=new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'long',day:'numeric',month:'long'}).format(Date.now());
 const previousTop=keepScroll?root.querySelector('.view__scroll')?.scrollTop||0:0;
 root.innerHTML=`<header class="nav-bar"><div class="nav-bar__leading"><span class="sa-brand">IDEAS</span></div><div class="nav-bar__title" aria-hidden="true">${esc(title)}</div><div class="nav-bar__trailing"><span class="connection-pill online" role="status" aria-label="Datos consultados en ${origin}"><span class="connection-dot"></span><span class="connection-pill__text">${origin}</span></span><button class="nav-btn staff-refresh" type="button" aria-label="Actualizar datos">${icon('refresh')}</button></div></header><div class="view__scroll"><div class="large-title"><div class="large-title__kicker">${route()==='home'?esc(date):'MI ESPACIO INSTITUCIONAL'}</div><div class="large-title__row"><h1 class="large-title__text" tabindex="-1">${esc(title)}</h1><span class="sa-account-chip">${esc(role)}</span></div></div><div class="view__content"><div class="page sa-page">${body}<div class="sa-sync-note">${origin} · ${panelLoadedAt?'Actualizado '+clock(panelLoadedAt):'Información según tus permisos'}</div></div></div></div>`;
 root.querySelector('.staff-refresh')?.addEventListener('click',event=>{event.currentTarget.classList.add('is-spinning');event.currentTarget.disabled=true;render({force:true,silent:QUIET_ROUTES.includes(route()),manual:true});});
 const scroller=root.querySelector('.view__scroll'),bar=root.querySelector('.nav-bar');
 const paintBar=()=>{bar.classList.toggle('is-scrolled',scroller.scrollTop>2);bar.classList.toggle('is-collapsed',scroller.scrollTop>58);};
 if(scroller&&previousTop){scroller.scrollTop=previousTop;paintBar();}
 scroller?.addEventListener('scroll',paintBar,{passive:true});
}
async function load(action,values={}){
 controller?.abort();const current=new AbortController();controller=current;const stamp=++sequence;
 try{const value=await staffRequest(action,values,{signal:current.signal});if(stamp!==sequence)throw Object.assign(new Error('Consulta reemplazada.'),{cancelled:true});return value;}
 catch(e){if(current.signal.aborted||stamp!==sequence)e.cancelled=true;throw e;}
}
function webLinks(){
 const links=(panel.accesos_web||[]).filter(link=>{try{const url=new URL(link.url);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}});
 return links.length?`<div class="list-header">Gestión en la web</div><div class="ios-card ios-card--flush list-group--icons">${links.map(link=>`<a class="list-row" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${rowIcon('server','blue')}<span class="list-row__main"><span>${esc(link.label)}</span><span class="list-row__sub">${esc(link.descripcion)}</span></span><span class="list-row__end">${icon('chevron-right')}</span></a>`).join('')}</div><p class="sa-caption">Se abrirá el panel web y puede solicitar tu cuenta.</p>`:'';
}
function home(){
 const u=panel.identidad,summary=panel.resumen||{},isTeacher=u.rol==='docente';
 const labels={trabajadores_activos:['Activos','users','green'],trabajadores_inactivos:['Inactivos','user','gray'],marcaciones_hoy:['Jornadas hoy','calendar','green'],en_sede:['Sin salida','clock','blue'],salidas_registradas:['Salidas','logout','blue'],tardanzas_hoy:['Tardanzas','clock','orange'],alumnos:['Alumnos activos','graduation-cap','green'],secciones:['Secciones','book','blue'],cursos_asignados:['Mis cursos','book','blue'],bloques_horario:['Bloques de horario','clock','orange']};
 const primaryKeys=(panel.permisos?.asistencia?['marcaciones_hoy','en_sede','tardanzas_hoy']:isTeacher?['cursos_asignados','bloques_horario']:['alumnos','secciones','trabajadores_activos']).filter(k=>summary[k]!==undefined);
 const metrics=primaryKeys.map(key=>{const [label,glyph,color]=labels[key];return `<div class="stat-tile stat-tile--${color}">${icon(glyph,'stat-tile__icon')}<span class="stat-tile__value">${esc(summary[key])}</span><span class="stat-tile__label">${label}</span></div>`;}).join('');
 const remaining=Object.entries(summary).filter(([key])=>!primaryKeys.includes(key));
 const details=remaining.length?`<div class="section-head"><span class="section-head__title">Tu resumen</span></div><div class="ios-card ios-card--flush list-group--icons">${remaining.map(([key,value])=>{const [label,glyph,color]=labels[key]||[key,'chart','gray'];return `<div class="list-row">${rowIcon(glyph,color)}<span class="list-row__main">${esc(label)}</span><span class="list-row__end tabular">${esc(value)}</span></div>`;}).join('')}</div>`:'';
 const marks=panel.marcaciones||[];
 content('Hoy',`<section class="hero sa-hero" aria-label="Mi resumen institucional"><div><div class="hero__greeting">Qué gusto verte,</div><div class="hero__name">${esc(String(u.nombre||'').trim().split(/\s+/)[0]||'equipo IDEAS')}</div><span class="hero__status">${esc(roleNames[u.rol]||u.rol_nombre||u.rol)}</span></div><div class="sa-hero-emblem">${icon(isTeacher?'book':'users')}</div></section>${panel.orientacion?`<p class="sa-caption">${esc(panel.orientacion)}</p>`:''}${metrics?`<div class="section-head"><span class="section-head__title">${isTeacher?'Mi actividad':'Hoy en IDEAS'}</span></div><div class="stats-row staff-overview">${metrics}</div>`:''}${panel.permisos?.estudiantes?`<a href="#students" class="cta"><span class="cta__icon">${icon('graduation-cap')}</span><span class="cta__text"><span class="cta__title">Consultar alumno</span><span class="cta__sub">Busca por nombre o DNI</span></span>${icon('chevron-right')}</a>`:''}${panel.permisos?.trabajadores?`<div class="list-header">Accesos rápidos</div><div class="ios-card ios-card--flush list-group--icons"><a href="#team" class="list-row">${rowIcon('qr','orange')}<span class="list-row__main"><span>Equipo y fotochecks</span><span class="list-row__sub">Consulta trabajadores o escanea su credencial</span></span><span class="list-row__end">${icon('chevron-right')}</span></a></div>`:''}${isTeacher?`<div class="section-head"><span class="section-head__title">Mis cursos</span></div>${courseCards(panel.cursos||[])}`:''}${details}${panel.permisos?.asistencia?`<div class="section-head"><span class="section-head__title">Marcaciones de hoy</span></div><div class="ios-card ios-card--flush list-group--icons">${marks.length?marks.map(m=>`<div class="list-row">${rowIcon('calendar','green')}<span class="list-row__main"><span>${esc(m.nombres+' '+m.apellidos)}</span><span class="list-row__sub">${esc(timeRange(m.hora_entrada,m.hora_salida))}</span></span><span class="list-row__end"><span class="${markChip(m.estado||'Registrado')}">${esc(m.estado||'Registrado')}</span></span></div>`).join(''):'<div class="staff-empty">No hay marcaciones registradas hoy.</div>'}</div>`:''}${webLinks()}${!metrics&&!isTeacher&&!panel.permisos?.estudiantes&&!panel.permisos?.trabajadores?`<div class="ios-card staff-person"><h2>Mi cuenta institucional</h2><p>${esc(u.nombre)}</p><p>${esc(u.email||'Correo sin registrar')}</p></div>`:''}`);
 bindCourses();
}
function courseCards(courses){return courses.length?`<div class="ios-card ios-card--flush list-group--icons">${courses.map(c=>`<button class="list-row" data-course="${Number(c.id)}">${rowIcon('book','indigo')}<span class="list-row__main"><span>${esc(c.nombre)}</span><span class="list-row__sub">${esc(c.seccion)} · ${esc(c.periodo)} · ${esc(c.turno)}</span></span><span class="list-row__end">${icon('chevron-right')}</span></button>`).join('')}</div>`:empty('No tienes cursos asignados vigentes. Administración debe registrar tu asignación.');}
function bindCourses(){root.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{selectedCourse=Number(b.dataset.course);offset=0;if(route()==='courses')render();else location.hash='#courses';}));}
function searchForm(value='',label='DNI o nombre'){return `<form id="staff-search" class="staff-search"><label for="staff-query">${esc(label)}</label><div><input id="staff-query" class="ios-input" type="search" name="q" maxlength="100" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(value)}" placeholder="Buscar…"><button class="ios-btn ios-btn-primary" type="submit">Buscar</button></div></form>`;}
async function students(query=studentQuery,page=searchPage){
 const data=await load('buscar_alumnos',{q:query,page});searchPage=data.page;studentQuery=query;
 content('Alumnos',searchForm(query)+`<p class="staff-subtitle">${Number(data.total)} resultado(s) · página ${Number(data.page)} de ${Number(data.pages)}</p><div class="staff-list"><div class="ios-card ios-card--flush list-group--icons">${data.items.map(a=>`<button class="list-row" data-student="${Number(a.id)}">${rowIcon('graduation-cap','blue')}<span class="list-row__main"><span>${esc(a.nombre+' '+a.apellido)}</span><span class="list-row__sub">${esc(a.dni)} · ${esc(a.programa||'Sin programa')} · ${esc(a.matricula_estado||'Sin matrícula')}</span></span><span class="list-row__end">${panel.permisos.ficha?icon('chevron-right'):''}</span></button>`).join('')||empty('No se encontraron alumnos.')}</div><div class="staff-actions"><button class="ios-btn ios-btn-secondary" id="staff-prev" ${data.page<=1?'disabled':''}>Anterior</button><button class="ios-btn ios-btn-secondary" id="staff-next" ${data.page>=data.pages?'disabled':''}>Siguiente</button></div></div>`);
 root.querySelector('#staff-search').addEventListener('submit',e=>{e.preventDefault();perform(()=>students(new FormData(e.target).get('q'),1));});
 root.querySelector('#staff-prev').onclick=()=>perform(()=>students(query,searchPage-1));root.querySelector('#staff-next').onclick=()=>perform(()=>students(query,searchPage+1));
 root.querySelectorAll('[data-student]').forEach(b=>b.onclick=()=>panel.permisos.ficha?perform(()=>{selectedPeriod=null;return student(Number(b.dataset.student));},'student'):showNotice('Tu permiso permite consultar el padrón; la ficha ampliada requiere autorización.'));
}
async function student(id){const data=await load('ficha_alumno',{id});selectedStudentId=id;paintStudent(data,selectedPeriod);}
function paintStudent(data,period=null){
 const periods=[...new Set((data.matriculas||[]).map(m=>m.periodo).filter(Boolean))];period=period??periods[0]??'*';if(period!=='*'&&!periods.includes(period))period=periods[0]??'*';selectedPeriod=period;const rows=list=>(list||[]).filter(r=>period==='*'||r.periodo===period);
 const obligations=rows(data.finanzas?.obligaciones),balance=obligations.reduce((n,o)=>n+Math.round(Number(o.saldo)*100),0)/100;
 content('Ficha del alumno',`<button class="staff-back" id="staff-return">${icon('chevron-left')} Volver a buscar</button><h2>${esc(data.alumno.nombre+' '+data.alumno.apellido)}</h2><p class="staff-subtitle">DNI ${esc(data.alumno.dni)}</p><label class="staff-label" for="staff-period">Periodo académico</label><select class="ios-input" id="staff-period">${periods.map(p=>`<option value="${esc(p)}" ${p===period?'selected':''}>${esc(p)}</option>`).join('')}<option value="*" ${period==='*'?'selected':''}>Todos los periodos</option></select>${data.finanzas?`<article class="ios-card staff-balance"><span>Saldo pendiente del periodo</span><strong>${money(balance)}</strong><small>Los conceptos anulados se excluyen. Los comprobantes en revisión siguen pendientes de validación.</small></article>`:empty('Tu cuenta no tiene permiso para consultar finanzas.')}<details class="ios-card staff-detail"><summary>Datos de contacto</summary><p>${esc(data.alumno.email||'Correo sin registrar')}</p><p>${phoneChatMarkup(data.alumno.telefono,data.alumno.nombre)}</p></details><details class="ios-card staff-detail"><summary>Matrículas</summary>${table(['Periodo','Programa','Sección','Estado'],rows(data.matriculas).map(m=>[esc(m.periodo),esc(m.programa),esc(m.seccion),esc(m.estado)]))}</details><details class="ios-card staff-detail"><summary>Cursos y horarios</summary>${table(['Curso','Sección'],rows(data.cursos).map(c=>[esc(c.nombre),esc(c.seccion)]))}${table(['Día','Hora','Curso / aula'],rows(data.horarios).map(h=>[esc(days[Number(h.dia)]||'—'),esc(timeRange(h.hora_inicio,h.hora_fin)),esc(h.curso+' · '+(h.aula||'—'))]))}</details><details class="ios-card staff-detail"><summary>Notas</summary>${table(['Curso','Parcial','Nota / 20'],rows(data.evaluaciones).map(n=>[esc(n.curso||'Evaluación'),esc(n.parcial),esc(n.nota)]))}</details>${data.finanzas?`<details class="ios-card staff-detail" open><summary>Deudas y pagos</summary>${table(['Concepto','Vence','Saldo','Estado'],obligations.map(o=>[esc(o.descripcion),esc(o.vence||'—'),money(o.saldo),esc(o.estado)]))}<p class="staff-subtitle">Los cobros y comprobantes se gestionan en la intranet.</p></details>`:''}<details class="ios-card staff-detail"><summary>Asistencias recientes</summary><p class="staff-subtitle">Registros generales, sin filtro de periodo.</p>${table(['Fecha','Curso','Estado'],(data.asistencia?.historial||[]).map(a=>[esc(a.fecha),esc(a.curso),esc(a.estado)]))}</details>`);
 root.querySelector('#staff-return').onclick=()=>{selectedStudentId=null;selectedPeriod=null;perform(()=>students());};root.querySelector('#staff-period').onchange=e=>paintStudent(data,e.target.value);
}
async function team(query=teamQuery){
 const data=await load('trabajadores',{q:query});teamQuery=query;
 content('Equipo y credenciales',`<p class="staff-subtitle">El fotocheck identifica al titular. No registra asistencia ni abre una sesión.</p><button class="ios-btn ios-btn-primary" id="staff-scan">${icon('qr')} Escanear fotocheck</button>${searchForm(query,'Nombre, DNI o código')}<div class="ios-card ios-card--flush list-group--icons">${data.items.map(w=>`<button class="list-row" data-worker="${Number(w.id)}">${rowIcon('user','orange')}<span class="list-row__main"><span>${esc(w.nombres+' '+w.apellidos)}</span><span class="list-row__sub">${esc(w.codigo_interno)} · ${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')} · ${esc(w.estado)}</span></span><span class="list-row__end">${icon('chevron-right')}</span></button>`).join('')||empty('Sin coincidencias.')}</div>`);
 root.querySelector('#staff-search').onsubmit=e=>{e.preventDefault();perform(()=>team(new FormData(e.target).get('q')));};root.querySelector('#staff-scan').onclick=startCardReader;root.querySelectorAll('[data-worker]').forEach(button=>button.onclick=()=>perform(()=>worker(Number(button.dataset.worker)),'worker'));
}
async function worker(id){const data=await load('trabajador',{id});selectedWorkerId=id;paintWorker(data.trabajador);}
function paintWorker(w,credential=false){
 content(credential?'Credencial validada':'Ficha del trabajador',`<button class="staff-back" id="staff-worker-back">${icon('chevron-left')} Volver al equipo</button><article class="ios-card staff-person"><span class="staff-eyebrow">${credential?'Trabajador activo · Validado por el servidor':esc(w.estado||'Ficha institucional')}</span><h2>${esc(w.nombres+' '+w.apellidos)}</h2><p>${esc(w.codigo_interno)} · DNI ${esc(w.dni)}</p><p>${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')}</p><p>${esc(w.email||'Correo sin registrar')}</p><p>${phoneChatMarkup(w.telefono,w.nombres+' '+w.apellidos)}</p></article>${credential?'<button class="ios-btn ios-btn-secondary" id="staff-scan-again">Escanear otra credencial</button>':''}`);
 root.querySelector('#staff-worker-back').onclick=()=>{selectedWorkerId=null;perform(()=>team());};if(credential)root.querySelector('#staff-scan-again').onclick=startCardReader;
}
async function startCardReader(){
 stopCamera();const generation=readerGeneration;let lookupPending=false;
 content('Leer fotocheck',`<button class="staff-back" id="staff-close-scan">${icon('chevron-left')} Volver al equipo</button><div class="staff-camera"><video id="staff-video" playsinline muted autoplay></video></div><p id="staff-camera-status" role="status">Abriendo cámara…</p><form id="staff-code-form"><label for="staff-code">También puedes pegar el enlace del QR</label><input class="ios-input" id="staff-code" maxlength="500"><button type="submit" class="ios-btn ios-btn-secondary">Consultar credencial</button></form>`);
 root.querySelector('#staff-close-scan').onclick=()=>{stopCamera();perform(()=>team());};
 const lookup=async code=>{if(lookupPending||generation!==readerGeneration)return;lookupPending=true;stopCamera();await perform(async()=>{const result=await load('leer_credencial',{codigo:code});const w=result.trabajador;selectedWorkerId=Number(w.id);paintWorker(w,true);});};
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
 const u=panel.identidad,server=studentServerInfo(),name=String(u.nombre||'Personal'),initials=name.trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase();
 const detail=(label,value,glyph,color)=>`<div class="list-row">${rowIcon(glyph,color)}<span class="list-row__main">${label}</span><span class="list-row__end sa-field">${esc(value)}</span></div>`;
 content('Perfil',`<div class="profile-head"><span class="avatar avatar--initials sa-avatar">${esc(initials)}</span><h2 class="profile-head__name">${esc(name)}</h2><p class="profile-head__sub">${esc(roleNames[u.rol]||u.rol_nombre||u.rol)} · ${u.origen==='intranet'?'Intranet':'Asistencia'}</p></div><div class="list-header">Mis datos</div><div class="ios-card ios-card--flush list-group--icons">${u.dni?detail('DNI',u.dni,'idcard','blue'):''}${detail('Correo',u.email||'Sin registrar','mail','blue')}${u.telefono?detail('Teléfono',u.telefono,'phone','green'):''}</div>${(u.origen==='asistencia'||['administrador','docente'].includes(u.rol))?personalWebLoginMarkup(u.origen):''}<div class="list-header">Apariencia</div><div class="ios-card theme-card"><div class="theme-card__head">${rowIcon('moon','indigo')}<span class="list-row__main"><span>Tema</span><span class="list-row__sub">Elige cómo se ve tu app</span></span></div><div class="segmented" role="radiogroup" aria-label="Tema de la app">${[['auto','Automático'],['light','Claro'],['dark','Oscuro']].map(([key,label])=>`<button class="segmented__item ${getThemePreference()===key?'is-active':''}" data-staff-theme="${key}" role="radio" aria-checked="${getThemePreference()===key}">${key==='auto'?'':icon(key==='dark'?'moon':'sun')}<span>${label}</span></button>`).join('')}</div></div><div class="list-header">Navidad</div><div class="ios-card ios-card--flush"><label class="list-row"><span class="row-icon row-icon--green" aria-hidden="true">☃</span><span class="list-row__main"><span>Modo Navidad</span><span class="list-row__sub">Luces en tu foto, nieve y escena navideña</span></span><input type="checkbox" class="ios-switch" role="switch" data-ideas-season-toggle checked aria-label="Modo Navidad"></label><label class="list-row"><span class="row-icon row-icon--green" aria-hidden="true">♫</span><span class="list-row__main"><span>Música de Navidad</span><span class="list-row__sub">Sonido al entrar · En este dispositivo</span></span><input type="checkbox" class="ios-switch" role="switch" data-ideas-christmas-music checked aria-label="Música de Navidad"></label><button type="button" class="list-row" data-ideas-christmas-play><span class="list-row__main">Escuchar música navideña</span></button></div><div class="list-header">Aplicación</div><div class="ios-card ios-card--flush list-group--icons">${server?`<button class="list-row" id="staff-server">${rowIcon('server','gray')}<span class="list-row__main"><span>Servidor</span><span class="list-row__sub">${esc(server.label)}</span></span><span class="list-row__end">${icon('chevron-right')}</span></button>`:''}${detail('Versión',APP_VERSION,'info','gray')}</div><div class="ios-card ios-card--flush logout-area"><button class="list-row list-row--destructive sa-logout" id="staff-logout">${rowIcon('logout','red')}<span class="list-row__main">Cerrar sesión</span></button></div>`);
 bindPersonalWebLogin(root,{onIdle:()=>{}});root.querySelectorAll('[data-staff-theme]').forEach(b=>b.onclick=()=>{setThemePreference(b.dataset.staffTheme);keepScroll=true;try{profile();}finally{keepScroll=false;}});root.querySelector('#staff-server')?.addEventListener('click',openStudentServerSettings);root.querySelector('#staff-logout').onclick=confirmStaffLogout;
}
const isAdmin=()=>['superadmin','admin','administrador'].includes(panel?.identidad?.rol);
async function confirmStaffLogout(){
 if(loggingOut)return;
 const choice=await showActionSheet({title:'¿Cerrar sesión?',message:isAdmin()?'Saldrás del panel de administración en este teléfono. Para volver a entrar necesitarás tu usuario y contraseña.':'Saldrás de tu cuenta en este teléfono. Podrás volver a entrar con tu usuario y contraseña.',actions:[{label:'Cerrar sesión',value:'logout',style:'destructive'}]});
 if(choice!=='logout'||loggingOut)return;
 loggingOut=true;clearTimeout(timer);controller?.abort();
 const button=root.querySelector('#staff-logout');if(button){button.disabled=true;button.setAttribute('aria-busy','true');const label=button.querySelector('.list-row__main');if(label)label.textContent='Cerrando sesión…';}
 try{await staffLogout();}catch{}
 // staffLogout recarga la app; si otra cuenta tomó el control antes, se restablece el botón.
 setTimeout(()=>{if(staffSession()){loggingOut=false;if(route()==='profile'&&panel)profile();}},1500);
}
function showNotice(message){content('Aviso',`<p class="staff-empty" role="status">${esc(message)}</p><button class="ios-btn ios-btn-secondary" id="staff-retry">Volver</button>`);root.querySelector('#staff-retry').onclick=render;}
function expirePanel(){
 viewGeneration++;panelLoadedAt=0;panelOwner=null;sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);panel=null;forgetStaffSession();
 root.innerHTML=`<div class="view__scroll"><div class="view__content"><div class="page sa-page staff-expired"><div class="empty-state sa-empty"><span class="sa-empty-icon">${icon('shield')}</span><h1>Sesión finalizada</h1><p>Tu sesión venció o tus permisos cambiaron. Vuelve a ingresar para continuar.</p><button id="staff-login" class="ios-btn ios-btn-primary">Iniciar sesión</button></div></div></div></div>`;
 const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';root.querySelector('#staff-login').onclick=()=>location.reload();
}
function handleAccountChange(event){
 if((event.key!==null&&event.key!=='ideas-personal-session:v1')||event.oldValue===event.newValue)return;
 viewGeneration++;panelLoadedAt=0;panelOwner=null;sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);panel=null;
 root.innerHTML=empty('La cuenta cambió. Abriendo la sesión actual…');const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';location.reload();
}
function scheduleSessionExpiry(){
 clearTimeout(expiryTimer);const session=staffSession();if(!session){expirePanel();return;}
 expiryTimer=setTimeout(()=>{if(staffSession())scheduleSessionExpiry();else expirePanel();},Math.max(1,session.expires-Date.now()+20));
}
function beginView(){
 const generation=++viewGeneration;sequence++;controller?.abort();controller=null;stopCamera();clearTimeout(timer);return generation;
}
async function perform(action,kind=null,{loading=true,quiet=false}={}){
 const generation=loading?beginView():viewGeneration;
 if(loading)paintSkeleton(kind);
 try{await action();}catch(e){if(e.cancelled||generation!==viewGeneration)return;if(!staffSession()||e.status===401){expirePanel();return;}if(quiet){const pill=root.querySelector('.connection-pill');pill?.classList.remove('online','is-syncing');pill?.classList.add('offline');const text=pill?.querySelector('.connection-pill__text');if(text)text.textContent='Sin conexión';root.querySelector('.staff-refresh')?.classList.remove('is-spinning');const refresh=root.querySelector('.staff-refresh');if(refresh)refresh.disabled=false;showToast('No se pudo actualizar. Se muestran los últimos datos.','warning');return;}showNotice(e.message||'No se pudo consultar el servidor.');}
}
function paintSkeleton(kind=null){
 kind=kind||(route()==='students'&&selectedStudentId?'student':route()==='team'&&selectedWorkerId?'worker':route());
 const labels={home:'Hoy',students:'Alumnos',student:'Ficha del alumno',team:'Equipo y credenciales',worker:'Ficha del trabajador',profile:'Perfil',courses:'Mis cursos',schedule:'Mi horario'};
 const row='<div class="skeleton-row"><span class="skeleton skeleton--block"></span><span class="staff-skeleton-lines"><span class="skeleton skeleton--line"></span><span class="skeleton skeleton--line skeleton--w60"></span></span></div>';
 const list=`<div class="ios-card ios-card--flush">${row.repeat(5)}</div>`;
 const search='<div class="skeleton staff-skeleton-search"></div>';
 const hero='<div class="skeleton staff-skeleton-hero"></div>';
 const profile='<div class="staff-skeleton-profile"><div class="skeleton staff-skeleton-avatar"></div><div class="skeleton skeleton--line"></div></div>';
 const body=kind==='home'?`${hero}<div class="stats-row staff-skeleton-stats">${[1,2,3].map(()=>'<div class="skeleton staff-skeleton-stat"></div>').join('')}</div>${list}`:kind==='profile'?profile+list:['students','team'].includes(kind)?search+list:['student','worker'].includes(kind)?hero+list:list;
 content(labels[kind]||'Hoy',`<div class="staff-skeleton" role="status" aria-label="Actualizando información" aria-busy="true"><div aria-hidden="true">${body}</div></div>`);
 root.querySelector('.connection-pill')?.setAttribute('aria-label','Conectando con el servidor');
 root.querySelector('.connection-pill')?.classList.remove('online');root.querySelector('.connection-pill')?.classList.add('is-syncing');
}
async function updatePanel(force=false){
 const session=staffSession();if(!session)throw Object.assign(new Error('La sesión finalizó.'),{status:401});
 const courseKey=route()==='courses'&&selectedCourse!==null?String(selectedCourse)+':'+offset:'';
 if(!force&&panel&&panelLoadedAt>0&&panelOwner===session.token&&Date.now()-panelLoadedAt<PANEL_TTL&&(!courseKey||courseKey===panelCourseKey))return;
 let data;
 try{data=await load('panel',{curso:route()==='courses'?selectedCourse:null,offset});}
 catch(e){if(e.status!==404||route()!=='courses'||selectedCourse===null)throw e;selectedCourse=null;offset=0;data=await load('panel',{curso:null,offset:0});showToast('El curso ya no está disponible en tus asignaciones.','info');}
 panel=data;panelLoadedAt=Date.now();panelOwner=session.token;panelCourseKey=selectedCourse!==null&&route()==='courses'?String(selectedCourse)+':'+offset:'';
}
async function render({force=false,silent=false,manual=false}={}){
 if(personalQrOpen()||loggingOut)return;
 // En segundo plano solo se repinta una pantalla de resumen ya dibujada y sin un campo en uso.
 silent=silent===true&&Boolean(panel)&&QUIET_ROUTES.includes(route())&&!scanner&&!root.querySelector('input:focus,select:focus,textarea:focus');
 const generation=beginView(),target=route();
 if(silent){const pill=root.querySelector('.connection-pill');pill?.classList.remove('online','offline');pill?.classList.add('is-syncing');}else paintSkeleton();
 await perform(async()=>{
  await updatePanel(force||target==='courses');if(generation!==viewGeneration||target!==route())return;
  const allowed=tabList().map(t=>t[0]);if(!allowed.includes(target)){location.hash='#home';return;}
  if(target==='students'){try{await (selectedStudentId?student(selectedStudentId):students());}catch(e){if(e.status!==404||!selectedStudentId)throw e;selectedStudentId=null;selectedPeriod=null;await students();showToast('El alumno ya no está disponible.','info');}}
  else if(target==='team'){try{await (selectedWorkerId?worker(selectedWorkerId):team());}catch(e){if(e.status!==404||!selectedWorkerId)throw e;selectedWorkerId=null;await team();showToast('El trabajador ya no está disponible.','info');}}
  else{keepScroll=silent;try{if(target==='courses')courses();else if(target==='schedule')schedule();else if(target==='profile')profile();else home();}finally{keepScroll=false;}}
 },null,{loading:false,quiet:silent});
 if(manual&&silent&&generation===viewGeneration&&panelLoadedAt&&Date.now()-panelLoadedAt<5000)showToast('Datos actualizados','success',1600);
 if(generation===viewGeneration&&!document.hidden&&target==='home')timer=setTimeout(()=>render({force:true,silent:true}),60000);
}
export async function initStaffApp(){
 initTheme();useProfileServerControls();document.body.classList.add('student-mode','staff-mode');document.body.classList.remove('no-bottom-nav');document.getElementById('ios-install-banner')?.remove();
 if('serviceWorker' in navigator&&location.hostname!=='appassets.androidplatform.net')navigator.serviceWorker.ready.then(reg=>{
  if(reg.scope!==new URL('../',import.meta.url).href)return;let announced=false;
  const announce=()=>{if(announced||!navigator.serviceWorker.controller)return;announced=true;showToast('Hay una versión nueva. Cierra todas las pestañas de esta app y vuelve a abrirla para actualizar.','info',12000);};
  if(reg.waiting)announce();const watch=()=>{const worker=reg.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')announce();});};reg.addEventListener('updatefound',watch);watch();
 }).catch(()=>{});
 document.getElementById('app-view').innerHTML='<section class="view view--tab student-view staff-view"></section>';root=document.querySelector('.staff-view');
 window.addEventListener('storage',handleAccountChange);window.addEventListener('hashchange',render);document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();clearTimeout(timer);controller?.abort();}else render({force:true,silent:true});});window.addEventListener('online',()=>render({force:true,silent:true}));window.addEventListener('offline',()=>{const pill=root?.querySelector('.connection-pill');pill?.classList.remove('online','is-syncing');pill?.classList.add('offline');const text=pill?.querySelector('.connection-pill__text');if(text)text.textContent='Sin conexión';});window.addEventListener('beforeunload',stopCamera);
 window.__androidBack=()=>{if(handlePersonalQrBack())return 'handled';if(scanner){stopCamera();render();return 'handled';}if(route()==='students'&&selectedStudentId){selectedStudentId=null;selectedPeriod=null;perform(()=>students());return 'handled';}if(route()==='team'&&selectedWorkerId){selectedWorkerId=null;perform(()=>team());return 'handled';}if(route()==='courses'&&selectedCourse){selectedCourse=null;offset=0;render();return 'handled';}if(route()!=='home'){location.hash='#home';return 'handled';}return 'exit';};
 scheduleSessionExpiry();await render();
}
