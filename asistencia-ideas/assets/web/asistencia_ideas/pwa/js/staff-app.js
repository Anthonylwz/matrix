import {staffSession,staffRequest,staffLogout,forgetStaffSession} from './staff-api.js';
import {initTheme,getThemePreference,setThemePreference} from './theme.js';
import {icon} from './icons.js';
import {showToast,showActionSheet,hapticFeedback,APP_VERSION} from './utils.js';
import {useProfileServerControls,studentServerInfo,openStudentServerSettings} from './student-server.js';
import {consumeDetectedAccount,copyText} from './login-assist.js';
import {dismissTopSheet} from './sheet.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'S/ '+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeRange=(start,end)=>[start,end].map(value=>typeof value==='string'&&/^\d{2}:\d{2}/.test(value)?value.slice(0,5):'—').join('–');
const days=['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const roleNames={superadmin:'Superadministrador',admin:'Administrador',supervisor:'Supervisor',readonly:'Consulta',administrador:'Administrador',docente:'Docente',secretaria:'Secretaría'};
const statLabels={trabajadores_activos:'Trabajadores activos',marcaciones_hoy:'Marcaciones hoy',alumnos:'Alumnos activos',secciones:'Secciones activas'};
const statIcons={trabajadores_activos:'users',marcaciones_hoy:'clock',alumnos:'graduation-cap',secciones:'book'};
const permissionNames={estudiantes:'Consultar alumnos',ficha:'Ficha ampliada del alumno',finanzas:'Deudas y pagos del alumno',trabajadores:'Equipo y fotochecks',asistencia:'Marcaciones del día'};
let root,panel,sequence=0,controller,scanner=null,timer=null,selectedCourse=null,offset=0,searchPage=1,studentQuery='',teamQuery='',expiryTimer=null,warnTimer=null,readerGeneration=0;
// Estado de la interfaz que se conserva entre actualizaciones (filtros, búsquedas y último dato correcto).
let lastUpdated=0,markFilter='all',markQuery='',teamFilter='all',courseQuery='',scheduleDay='all',scanLog=[],busy=false,silentPaint=false;
const route=()=>location.hash.slice(1).split('?')[0]||'home';
const empty=text=>`<p class="staff-empty">${esc(text)}</p>`;
const table=(heads,rows)=>`<div class="staff-table"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
// ── Utilidades de presentación ──
const limaParts=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return {hour:Number(parts.hour)%24,minute:Number(parts.minute),day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday)+1};};
const greeting=()=>{const h=limaParts().hour;return h<12?'Buenos días':h<19?'Buenas tardes':'Buenas noches';};
const dateLima=()=>{const text=new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'long',day:'numeric',month:'long'}).format(new Date());return text.charAt(0).toUpperCase()+text.slice(1);};
const clock=ts=>new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'}).format(ts);
const minutesOf=value=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(value||''));return m?Number(m[1])*60+Number(m[2]):null;};
const initials=name=>String(name||'').trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase()||'·';
const norm=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const pct=(part,total)=>total>0?Math.round(part*100/total):0;
const numeric=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const average=list=>{const values=list.filter(numeric).map(Number);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
const fmtGrade=value=>value===null?'—':value.toLocaleString('es-PE',{maximumFractionDigits:1,minimumFractionDigits:1});
const humanize=key=>String(key).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
// Color del estado según su texto (el servidor decide los nombres; aquí solo se colorean).
function tone(state){const s=norm(state);if(/falt|ausen|rechaz|anulad|inactiv|suspend|bloque|vencid|retir/.test(s))return 'danger';if(/tard|pendient|revision|parcial|permiso|justific/.test(s))return 'warning';if(/puntual|presente|activo|matricul|pagad|complet|a tiempo|vigente|aprob/.test(s))return 'success';return 'neutral';}
const badge=state=>state?`<span class="staff-badge staff-badge--${tone(state)}">${esc(state)}</span>`:'';
async function copyAndTell(text,okMessage,failMessage='No se pudo copiar en este equipo.'){const ok=await copyText(text);showToast(ok?okMessage:failMessage,ok?'success':'warning');}
const avatar=name=>`<span class="staff-avatar" aria-hidden="true">${esc(initials(name))}</span>`;
function stopCamera(){readerGeneration++;scanner?.stop();scanner=null;}
// ── Recientes del panel (solo este celular y esta cuenta; se borran al cerrar sesión) ──
const RECENT_KEY='ideas-staff-recent:v1';
function recentOwner(){const s=staffSession();return s?`${s.server}|${s.identity?.origen}|${s.identity?.id}`:'';}
function loadRecent(){try{const value=JSON.parse(localStorage.getItem(RECENT_KEY)||'null');if(value?.owner===recentOwner())return {queries:Array.isArray(value.queries)?value.queries:[],students:Array.isArray(value.students)?value.students:[]};}catch{}return {queries:[],students:[]};}
function saveRecent(update){const current=loadRecent();const next=update(current);try{localStorage.setItem(RECENT_KEY,JSON.stringify({owner:recentOwner(),queries:next.queries.slice(0,6),students:next.students.slice(0,6)}));}catch{}}
function rememberQuery(query){const q=String(query||'').trim();if(q.length<2)return;saveRecent(r=>({...r,queries:[q,...r.queries.filter(x=>norm(x)!==norm(q))]}));}
function rememberStudent(a){if(!a?.id)return;saveRecent(r=>({...r,students:[{id:Number(a.id),nombre:`${a.nombre||''} ${a.apellido||''}`.trim(),dni:a.dni||''},...r.students.filter(x=>Number(x.id)!==Number(a.id))]}));}
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
 moveTabIndicator();
}
// Píldora bajo la pestaña activa, igual que en las apps de trabajador y alumno.
function moveTabIndicator(){
 const nav=document.getElementById('bottom-nav');if(!nav)return;
 let pill=nav.querySelector('.tab-indicator');if(!pill){pill=document.createElement('span');pill.className='tab-indicator no-anim';pill.setAttribute('aria-hidden','true');nav.prepend(pill);}
 requestAnimationFrame(()=>{const active=nav.querySelector('.tab-item.active');if(!active||!active.offsetWidth){pill.style.opacity='0';return;}pill.style.opacity='1';pill.style.width=`${active.offsetWidth}px`;pill.style.transform=`translateX(${active.offsetLeft}px)`;requestAnimationFrame(()=>pill.classList.remove('no-anim'));});
}
function statusLine(){
 const offline=navigator.onLine===false;
 return `<p class="staff-status ${offline?'is-offline':''}" role="status"><span class="staff-status__dot"></span>${offline?'Sin conexión · mostrando la última consulta':lastUpdated?'Actualizado a las '+esc(clock(lastUpdated)):'Conectado'}</p>`;
}
function content(title,body){
 // En una actualización silenciosa se conserva el desplazamiento; al navegar se vuelve arriba.
 const scroll=silentPaint?root.scrollTop:0;
 chrome();root.innerHTML=`<header class="staff-header"><div><span class="staff-eyebrow">${esc(roleNames[panel?.identidad.rol]||'Cuenta institucional')} · ${panel?.identidad.origen==='intranet'?'Intranet':'Asistencia'}</span><h1 tabindex="-1">${esc(title)}</h1>${statusLine()}</div><button class="staff-refresh" type="button" aria-label="Actualizar datos" ${busy?'disabled':''}>${icon('refresh')}</button></header>${body}`;
 root.querySelector('.staff-refresh')?.addEventListener('click',()=>render());
 root.scrollTop=scroll;
}
async function load(action,values={}){
 controller?.abort();const current=new AbortController();controller=current;const stamp=++sequence;
 try{const value=await staffRequest(action,values,{signal:current.signal});if(stamp!==sequence)throw Object.assign(new Error('Consulta reemplazada.'),{cancelled:true});return value;}
 catch(e){if(current.signal.aborted||stamp!==sequence)e.cancelled=true;throw e;}
}
// ── Inicio ──
function marksOf(){return Array.isArray(panel?.marcaciones)?panel.marcaciones:[];}
function attendanceOverview(){
 const marks=marksOf(),resumen=panel.resumen||{};
 const total=Number(resumen.trabajadores_activos)||0;
 const present=marks.filter(m=>m.hora_entrada).length||Number(resumen.marcaciones_hoy)||0;
 const done=marks.filter(m=>m.hora_entrada&&m.hora_salida).length,working=marks.filter(m=>m.hora_entrada&&!m.hora_salida).length;
 const late=marks.filter(m=>tone(m.estado)==='warning'&&/tard/.test(norm(m.estado))).length;
 const missing=total?Math.max(0,total-present):0;
 const base=Math.max(total,present,1);
 return `<section class="ios-card staff-overview" aria-label="Asistencia de hoy"><div class="staff-overview__head"><div><span class="staff-eyebrow">Asistencia de hoy</span><strong>${total?pct(present,total)+'%':esc(present)}</strong><small>${total?`${esc(present)} de ${esc(total)} trabajadores con entrada`:'Trabajadores con entrada registrada'}</small></div><span class="staff-overview__icon">${icon('chart')}</span></div>
  <div class="staff-bar" role="img" aria-label="${esc(done)} con salida, ${esc(working)} en jornada${total?`, ${esc(missing)} sin marcar`:''}"><span class="staff-bar__done" style="width:${done*100/base}%"></span><span class="staff-bar__work" style="width:${working*100/base}%"></span></div>
  <ul class="staff-legend"><li><span class="dot dot--done"></span>Con salida <b>${esc(done)}</b></li><li><span class="dot dot--work"></span>En jornada <b>${esc(working)}</b></li>${total?`<li><span class="dot dot--miss"></span>Sin marcar <b>${esc(missing)}</b></li>`:''}<li><span class="dot dot--late"></span>Tardanzas <b>${esc(late)}</b></li></ul></section>`;
}
function filteredMarks(){
 const q=norm(markQuery);
 return marksOf().filter(m=>{
  if(markFilter==='open'&&!(m.hora_entrada&&!m.hora_salida))return false;
  if(markFilter==='done'&&!(m.hora_entrada&&m.hora_salida))return false;
  if(markFilter.startsWith('estado:')&&norm(m.estado)!==markFilter.slice(7))return false;
  return !q||norm(`${m.nombres} ${m.apellidos} ${m.apellidos} ${m.nombres}`).includes(q);
 }).sort((a,b)=>(minutesOf(a.hora_entrada)??9999)-(minutesOf(b.hora_entrada)??9999));
}
function marksTable(){
 const rows=filteredMarks();
 return `<p class="staff-subtitle" id="staff-marks-count">${rows.length} de ${marksOf().length} marcaciones</p>${rows.length?table(['Trabajador','Entrada','Salida','Estado'],rows.map(m=>[esc(m.nombres+' '+m.apellidos),esc(m.hora_entrada||'—'),esc(m.hora_salida||'—'),badge(m.estado)||esc(m.estado)])):empty(marksOf().length?'Ninguna marcación coincide con el filtro.':'No hay marcaciones registradas hoy.')}`;
}
function marksSection(){
 const marks=marksOf();
 if(!marks.length)return `<h2 id="staff-marks">Marcaciones de hoy</h2>${empty('No hay marcaciones registradas hoy.')}`;
 const states=[...new Map(marks.filter(m=>m.estado).map(m=>[norm(m.estado),m.estado])).entries()];
 const chips=[['all','Todas',marks.length],['open','En jornada',marks.filter(m=>m.hora_entrada&&!m.hora_salida).length],['done','Con salida',marks.filter(m=>m.hora_entrada&&m.hora_salida).length],...states.map(([key,label])=>['estado:'+key,label,marks.filter(m=>norm(m.estado)===key).length])];
 if(!chips.some(c=>c[0]===markFilter))markFilter='all';
 return `<div class="staff-section-head"><h2 id="staff-marks">Marcaciones de hoy</h2><button type="button" class="staff-link-btn" id="staff-copy-marks">${icon('clipboard')}Copiar reporte</button></div>
  <div class="staff-filter"><input id="staff-marks-query" class="ios-input" type="search" maxlength="80" placeholder="Buscar trabajador…" value="${esc(markQuery)}" aria-label="Buscar trabajador en las marcaciones" autocomplete="off"></div>
  <div class="staff-chips" role="group" aria-label="Filtrar marcaciones">${chips.map(([key,label,count])=>`<button type="button" class="staff-chip" data-mark-filter="${esc(key)}" aria-pressed="${markFilter===key}">${esc(label)} <b>${count}</b></button>`).join('')}</div>
  <div id="staff-marks-body">${marksTable()}</div>`;
}
function bindMarks(){
 const body=root.querySelector('#staff-marks-body');if(!body)return;
 root.querySelector('#staff-marks-query')?.addEventListener('input',e=>{markQuery=e.target.value;body.innerHTML=marksTable();});
 root.querySelectorAll('[data-mark-filter]').forEach(b=>b.addEventListener('click',()=>{markFilter=b.dataset.markFilter;root.querySelectorAll('[data-mark-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));body.innerHTML=marksTable();}));
 root.querySelector('#staff-copy-marks')?.addEventListener('click',copyMarksReport);
}
async function copyMarksReport(){
 const choice=await showActionSheet({title:'Copiar reporte de hoy',message:'Se copia al portapapeles para pegarlo en WhatsApp, correo o Excel.',actions:[{label:'Resumen para mensaje',value:'text'},{label:'Tabla para Excel (todas)',value:'tsv'}]});
 if(!choice)return;
 const marks=marksOf(),resumen=panel.resumen||{},total=Number(resumen.trabajadores_activos)||0,present=marks.filter(m=>m.hora_entrada).length;
 let text;
 if(choice==='tsv')text=['Trabajador\tEntrada\tSalida\tEstado',...marks.map(m=>[`${m.nombres} ${m.apellidos}`,m.hora_entrada||'',m.hora_salida||'',m.estado||''].map(v=>String(v).replace(/[\t\n]/g,' ')).join('\t'))].join('\n');
 else text=[`*Asistencia de hoy* — ${dateLima()}`,total?`Con entrada: ${present} de ${total} (${pct(present,total)}%)`:`Con entrada: ${present}`,`En jornada: ${marks.filter(m=>m.hora_entrada&&!m.hora_salida).length} · Con salida: ${marks.filter(m=>m.hora_entrada&&m.hora_salida).length}`,total?`Sin marcar: ${Math.max(0,total-present)}`:'','',markFilter!=='all'||markQuery.trim()?'Detalle (según el filtro aplicado):':'Detalle:',...filteredMarks().map(m=>`• ${m.nombres} ${m.apellidos} — ${m.hora_entrada||'—'} → ${m.hora_salida||'—'}${m.estado?` (${m.estado})`:''}`)].filter((line,i,all)=>line!==''||all[i-1]!=='').join('\n');
 await copyAndTell(text,'Reporte copiado. Pégalo donde lo necesites.');
}
function todayClasses(){
 const {day,hour,minute}=limaParts(),now=hour*60+minute;
 return (panel.horarios||[]).filter(h=>Number(h.dia)===day).sort((a,b)=>(minutesOf(a.hora_inicio)??0)-(minutesOf(b.hora_inicio)??0)).map(h=>{const start=minutesOf(h.hora_inicio),end=minutesOf(h.hora_fin);return {...h,state:start!==null&&end!==null&&now>=start&&now<end?'now':start!==null&&now<start?'next':'past'};});
}
function classList(items){return `<div class="staff-list">${items.map(h=>`<article class="ios-card staff-class staff-class--${h.state}"><span class="staff-class__time">${esc(timeRange(h.hora_inicio,h.hora_fin))}</span><span class="staff-class__main"><strong>${esc(h.curso)}</strong><small>${esc([h.seccion,h.aula?'Aula '+h.aula:'Sin aula'].filter(Boolean).join(' · '))}</small></span>${h.state==='now'?'<span class="staff-badge staff-badge--success">En curso</span>':h.state==='next'?'<span class="staff-badge staff-badge--info">Próxima</span>':'<span class="staff-badge staff-badge--neutral">Terminada</span>'}</article>`).join('')}</div>`;}
function home(){
 const resumen=panel.resumen||{};
 const links={trabajadores_activos:panel.permisos?.trabajadores?'#team':'',alumnos:panel.permisos?.estudiantes?'#students':'',marcaciones_hoy:panel.permisos?.asistencia?'marks':''};
 const stats=Object.entries(resumen).map(([key,value])=>{const target=links[key]||'',inner=`<span class="staff-stat__icon">${icon(statIcons[key]||'chart')}</span><span>${esc(statLabels[key]||humanize(key))}</span><strong>${esc(value)}</strong>`;return target.startsWith('#')?`<a class="ios-card staff-stat staff-stat--link" href="${target}">${inner}</a>`:target?`<button type="button" class="ios-card staff-stat staff-stat--link" data-scroll="staff-marks">${inner}</button>`:`<article class="ios-card staff-stat">${inner}</article>`;}).join('');
 const courses=panel.cursos||[];
 const isTeacher=panel.identidad.rol==='docente',classes=isTeacher?todayClasses():[];
 const showOverview=panel.permisos?.asistencia&&(resumen.trabajadores_activos!==undefined||marksOf().length);
 content(greeting()+', '+String(panel.identidad.nombre).split(' ')[0],`<p class="staff-subtitle">${esc(dateLima())} · Tu información y accesos según los permisos de tu cuenta.</p>${stats?`<section class="staff-stats">${stats}</section>`:''}${showOverview?attendanceOverview():''}${isTeacher?`<div class="staff-section-head"><h2>Mis clases de hoy</h2><a class="staff-link-btn" href="#schedule">Ver horario</a></div>${classes.length?classList(classes):empty('Hoy no tienes clases programadas.')}<h2>Mis cursos</h2>${courseCards(courses)}`:''}${panel.permisos?.estudiantes?`<a href="#students" class="ios-card staff-shortcut">${icon('graduation-cap')}<span>Consultar alumno<small>Busca por nombre o DNI y abre su ficha</small></span>${icon('chevron-right')}</a>`:''}${panel.permisos?.trabajadores?`<a href="#team" class="ios-card staff-shortcut">${icon('qr')}<span>Equipo y fotochecks<small>Consulta trabajadores o escanea su credencial</small></span>${icon('chevron-right')}</a>`:''}${panel.permisos?.asistencia?marksSection():''}${!stats&&!courses.length&&!panel.permisos?.trabajadores&&!panel.permisos?.estudiantes?empty('Tu cuenta está activa. Las funciones disponibles dependen de los permisos asignados en el sistema.'):''}`);
 bindCourses();bindMarks();
 root.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>root.querySelector('#'+b.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'})));
}
function courseCards(courses){return courses.length?`<div class="staff-list">${courses.map(c=>`<button class="ios-card staff-course" data-course="${Number(c.id)}"><span>${esc(c.nombre)}</span><small>${esc(c.seccion)} · ${esc(c.periodo)} · ${esc(c.turno)}</small>${icon('chevron-right')}</button>`).join('')}</div>`:empty('No tienes cursos asignados vigentes. Administración debe registrar tu asignación.');}
function bindCourses(){root.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{selectedCourse=Number(b.dataset.course);offset=0;courseQuery='';if(route()==='courses')render();else location.hash='#courses';}));}
function searchForm(value='',label='DNI o nombre'){return `<form id="staff-search" class="staff-search" role="search"><label for="staff-query">${esc(label)}</label><div><input id="staff-query" class="ios-input" name="q" type="search" maxlength="100" value="${esc(value)}" placeholder="Buscar…" autocomplete="off" enterkeyhint="search"><button class="ios-btn ios-btn-primary" type="submit">Buscar</button></div>${value?'<button type="button" class="staff-link-btn" id="staff-clear">Limpiar búsqueda</button>':''}</form>`;}
// ── Alumnos ──
async function students(query=studentQuery,page=searchPage){
 const data=await load('buscar_alumnos',{q:query,page});searchPage=data.page;studentQuery=query;if(query)rememberQuery(query);
 const recent=loadRecent();
 const recentBlock=!query&&(recent.queries.length||recent.students.length)?`<section class="staff-recent">${recent.students.length?`<h2>Fichas recientes</h2><div class="staff-list">${recent.students.map(s=>`<button class="ios-card staff-course staff-course--person" data-recent-student="${Number(s.id)}">${avatar(s.nombre)}<span>${esc(s.nombre)}<small>${s.dni?'DNI '+esc(s.dni):'Ficha consultada'}</small></span>${icon('chevron-right')}</button>`).join('')}</div>`:''}${recent.queries.length?`<h2>Búsquedas recientes</h2><div class="staff-chips">${recent.queries.map(q=>`<button type="button" class="staff-chip" data-recent-query="${esc(q)}">${icon('history')}${esc(q)}</button>`).join('')}</div>`:''}</section>`:'';
 content('Alumnos',searchForm(query)+recentBlock+`<p class="staff-subtitle">${Number(data.total)} resultado(s) · página ${Number(data.page)} de ${Number(data.pages)}</p><div class="staff-list">${data.items.map(a=>`<button class="ios-card staff-course staff-course--person" data-student="${Number(a.id)}">${avatar(a.nombre+' '+a.apellido)}<span>${esc(a.nombre+' '+a.apellido)}<small>${esc(a.dni)} · ${esc(a.programa||'Sin programa')}</small>${badge(a.matricula_estado||'Sin matrícula')}</span>${panel.permisos.ficha?icon('chevron-right'):''}</button>`).join('')||empty('No se encontraron alumnos.')}<div class="staff-actions"><button class="ios-btn ios-btn-secondary" id="staff-prev" ${data.page<=1?'disabled':''}>Anterior</button><button class="ios-btn ios-btn-secondary" id="staff-next" ${data.page>=data.pages?'disabled':''}>Siguiente</button></div></div>`);
 root.querySelector('#staff-search').addEventListener('submit',e=>{e.preventDefault();perform(()=>students(String(new FormData(e.target).get('q')||'').trim(),1));});
 root.querySelector('#staff-clear')?.addEventListener('click',()=>perform(()=>students('',1)));
 root.querySelector('#staff-prev').onclick=()=>perform(()=>students(query,searchPage-1));root.querySelector('#staff-next').onclick=()=>perform(()=>students(query,searchPage+1));
 const openStudent=id=>panel.permisos.ficha?perform(()=>student(id)):showNotice('Tu permiso permite consultar el padrón; la ficha ampliada requiere autorización.');
 root.querySelectorAll('[data-student]').forEach(b=>b.onclick=()=>openStudent(Number(b.dataset.student)));
 root.querySelectorAll('[data-recent-student]').forEach(b=>b.onclick=()=>openStudent(Number(b.dataset.recentStudent)));
 root.querySelectorAll('[data-recent-query]').forEach(b=>b.onclick=()=>perform(()=>students(b.dataset.recentQuery,1)));
}
async function student(id){const data=await load('ficha_alumno',{id});rememberStudent(data.alumno);paintStudent(data);}
function attendanceStats(list){
 const total=list.length,counts={};list.forEach(a=>{const key=a.estado||'Sin estado';counts[key]=(counts[key]||0)+1;});
 const attended=list.filter(a=>tone(a.estado)==='success'||/tard/.test(norm(a.estado))).length;
 return {total,counts,attended,rate:total?pct(attended,total):null};
}
function paintStudent(data,period=null){
 const periods=[...new Set(data.matriculas.map(m=>m.periodo).filter(Boolean))];period=period??periods[0]??'*';const rows=list=>(list||[]).filter(r=>period==='*'||r.periodo===period);
 const obligations=rows(data.finanzas?.obligaciones),balance=obligations.reduce((n,o)=>n+Math.round(Number(o.saldo)*100),0)/100;
 const grades=rows(data.evaluaciones),gradeAvg=average(grades.map(n=>n.nota)),att=attendanceStats(data.asistencia?.historial||[]);
 const enrollment=rows(data.matriculas)[0]||data.matriculas[0];
 const name=data.alumno.nombre+' '+data.alumno.apellido;
 const copyButton=(value,label)=>value?`<button type="button" class="staff-link-btn" data-copy="${esc(value)}" aria-label="Copiar ${esc(label)}">${icon('clipboard')}Copiar</button>`:'';
 content('Ficha del alumno',`<button class="staff-back" id="staff-return">${icon('chevron-left')} Volver a buscar</button><section class="ios-card staff-profile">${avatar(name)}<div><h2>${esc(name)}</h2><p class="staff-subtitle">DNI ${esc(data.alumno.dni)}${enrollment?.programa?' · '+esc(enrollment.programa):''}</p>${enrollment?badge(enrollment.estado):''}</div></section>
  <section class="staff-stats staff-stats--compact" aria-label="Resumen del periodo"><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('chart')}</span><span>Promedio de notas</span><strong>${fmtGrade(gradeAvg)}</strong><small>${grades.filter(n=>numeric(n.nota)).length} nota(s) · escala /20</small></article><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('circlecheck')}</span><span>Asistencia</span><strong>${att.rate===null?'—':att.rate+'%'}</strong><small>${att.total} registro(s) recientes</small></article><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('book')}</span><span>Cursos</span><strong>${rows(data.cursos).length}</strong><small>${period==='*'?'Todos los periodos':esc(period)}</small></article></section>
  <label class="staff-label" for="staff-period">Periodo académico</label><select class="ios-input" id="staff-period">${periods.map(p=>`<option value="${esc(p)}" ${p===period?'selected':''}>${esc(p)}</option>`).join('')}<option value="*" ${period==='*'?'selected':''}>Todos los periodos</option></select>${data.finanzas?`<article class="ios-card staff-balance ${balance>0?'has-debt':''}"><span>Saldo pendiente del periodo</span><strong>${money(balance)}</strong><small>Los conceptos anulados se excluyen. Los comprobantes en revisión siguen pendientes de validación.</small></article>`:empty('Tu cuenta no tiene permiso para consultar finanzas.')}<details class="ios-card staff-detail"><summary>Datos de contacto</summary><p class="staff-contact"><span>${esc(data.alumno.email||'Correo sin registrar')}</span>${copyButton(data.alumno.email,'correo')}</p><p class="staff-contact"><span>${esc(data.alumno.telefono||'Teléfono sin registrar')}</span>${copyButton(data.alumno.telefono,'teléfono')}</p></details><details class="ios-card staff-detail"><summary>Matrículas</summary>${table(['Periodo','Programa','Sección','Estado'],rows(data.matriculas).map(m=>[esc(m.periodo),esc(m.programa),esc(m.seccion),badge(m.estado)]))}</details><details class="ios-card staff-detail"><summary>Cursos y horarios</summary>${table(['Curso','Sección'],rows(data.cursos).map(c=>[esc(c.nombre),esc(c.seccion)]))}${table(['Día','Hora','Curso / aula'],rows(data.horarios).map(h=>[esc(days[Number(h.dia)]||'—'),esc(timeRange(h.hora_inicio,h.hora_fin)),esc(h.curso+' · '+(h.aula||'—'))]))}</details><details class="ios-card staff-detail"><summary>Notas <span class="staff-summary-meta">Promedio ${fmtGrade(gradeAvg)}</span></summary>${table(['Curso','Parcial','Nota / 20'],grades.map(n=>[esc(n.curso||'Evaluación'),esc(n.parcial),numeric(n.nota)?`<span class="staff-grade">${esc(n.nota)}</span>`:esc(n.nota)]))}</details>${data.finanzas?`<details class="ios-card staff-detail" open><summary>Deudas y pagos</summary>${table(['Concepto','Vence','Saldo','Estado'],obligations.map(o=>[esc(o.descripcion),esc(o.vence||'—'),money(o.saldo),badge(o.estado)]))}<p class="staff-subtitle">Los cobros y comprobantes se gestionan en la intranet.</p></details>`:''}<details class="ios-card staff-detail"><summary>Asistencias recientes ${att.total?`<span class="staff-summary-meta">${att.rate}% asistió</span>`:''}</summary><p class="staff-subtitle">Registros generales, sin filtro de periodo.</p>${att.total?`<div class="staff-chips">${Object.entries(att.counts).map(([k,v])=>`<span class="staff-chip is-static">${badge(k)} <b>${v}</b></span>`).join('')}</div>`:''}${table(['Fecha','Curso','Estado'],(data.asistencia?.historial||[]).map(a=>[esc(a.fecha),esc(a.curso),badge(a.estado)]))}</details><button type="button" class="ios-btn ios-btn-secondary staff-wide" id="staff-copy-student">${icon('clipboard')} Copiar resumen de la ficha</button>`);
 root.querySelector('#staff-return').onclick=()=>perform(()=>students());root.querySelector('#staff-period').onchange=e=>paintStudent(data,e.target.value);
 root.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copyAndTell(b.dataset.copy,'Copiado al portapapeles.'));
 root.querySelector('#staff-copy-student').onclick=async()=>{
  const text=[`*Ficha del alumno* — ${name}`,`DNI: ${data.alumno.dni}`,enrollment?`Programa: ${enrollment.programa||'—'} · ${enrollment.seccion||''} · ${enrollment.estado||''}`:'',`Periodo: ${period==='*'?'Todos':period}`,`Promedio de notas: ${fmtGrade(gradeAvg)}`,`Asistencia reciente: ${att.rate===null?'sin registros':att.rate+'%'}`,data.finanzas?`Saldo pendiente: ${money(balance)}`:''].filter(Boolean).join('\n');
  await copyAndTell(text,'Resumen copiado.');
 };
}
// ── Equipo ──
async function team(query=teamQuery){
 const data=await load('trabajadores',{q:query});teamQuery=query;
 const items=data.items||[],states=[...new Map(items.filter(w=>w.estado).map(w=>[norm(w.estado),w.estado])).entries()];
 if(teamFilter!=='all'&&!states.some(([k])=>k===teamFilter))teamFilter='all';
 const visible=()=>items.filter(w=>teamFilter==='all'||norm(w.estado)===teamFilter);
 const people=list=>list.map(w=>`<article class="ios-card staff-person staff-person--row">${avatar(w.nombres+' '+w.apellidos)}<div><strong>${esc(w.nombres+' '+w.apellidos)}</strong><p>${esc(w.codigo_interno)} · ${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')}</p>${badge(w.estado)||`<small>${esc(w.estado)}</small>`}</div></article>`).join('')||empty('Sin coincidencias.');
 const log=scanLog.length?`<details class="ios-card staff-detail"><summary>Credenciales validadas en esta sesión <span class="staff-summary-meta">${scanLog.length}</span></summary>${table(['Hora','Trabajador','Código'],scanLog.map(s=>[esc(clock(s.at)),esc(s.nombre),esc(s.codigo)]))}</details>`:'';
 content('Equipo y credenciales',`<p class="staff-subtitle">El fotocheck identifica al titular. No registra asistencia ni abre una sesión.</p><button class="ios-btn ios-btn-primary" id="staff-scan">${icon('qr')} Escanear fotocheck</button>${log}${searchForm(query,'Nombre, DNI o código')}${states.length>1?`<div class="staff-chips" role="group" aria-label="Filtrar por estado"><button type="button" class="staff-chip" data-team-filter="all" aria-pressed="${teamFilter==='all'}">Todos <b>${items.length}</b></button>${states.map(([k,label])=>`<button type="button" class="staff-chip" data-team-filter="${esc(k)}" aria-pressed="${teamFilter===k}">${esc(label)} <b>${items.filter(w=>norm(w.estado)===k).length}</b></button>`).join('')}</div>`:''}<p class="staff-subtitle" id="staff-team-count">${visible().length} trabajador(es)</p><div class="staff-list" id="staff-team-list">${people(visible())}</div>`);
 root.querySelector('#staff-search').onsubmit=e=>{e.preventDefault();perform(()=>team(String(new FormData(e.target).get('q')||'').trim()));};root.querySelector('#staff-scan').onclick=startCardReader;
 root.querySelector('#staff-clear')?.addEventListener('click',()=>perform(()=>team('')));
 root.querySelectorAll('[data-team-filter]').forEach(b=>b.onclick=()=>{teamFilter=b.dataset.teamFilter;root.querySelectorAll('[data-team-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));root.querySelector('#staff-team-list').innerHTML=people(visible());root.querySelector('#staff-team-count').textContent=`${visible().length} trabajador(es)`;});
}
async function startCardReader(){
 stopCamera();const generation=readerGeneration;let lookupPending=false;
 content('Leer fotocheck',`<button class="staff-back" id="staff-close-scan">${icon('chevron-left')} Volver al equipo</button><div class="staff-camera"><video id="staff-video" playsinline muted autoplay></video><span class="staff-camera__frame" aria-hidden="true"></span></div><p id="staff-camera-status" role="status">Abriendo cámara…</p><form id="staff-code-form"><label for="staff-code">También puedes pegar el enlace del QR</label><input class="ios-input" id="staff-code" maxlength="500"><button type="submit" class="ios-btn ios-btn-secondary">Consultar credencial</button></form>`);
 root.querySelector('#staff-close-scan').onclick=()=>{stopCamera();perform(()=>team());};
 const lookup=async code=>{if(lookupPending||generation!==readerGeneration)return;lookupPending=true;stopCamera();await perform(async()=>{const result=await load('leer_credencial',{codigo:code});const w=result.trabajador,at=Date.now();try{hapticFeedback([25,40,25]);}catch{}scanLog=[{at,nombre:w.nombres+' '+w.apellidos,codigo:w.codigo_interno||''},...scanLog].slice(0,20);content('Credencial validada',`<article class="ios-card staff-person staff-person--valid"><span class="staff-valid-icon">${icon('circlecheck')}</span><span class="staff-eyebrow">Trabajador activo · Validado por el servidor a las ${esc(clock(at))}</span><h2>${esc(w.nombres+' '+w.apellidos)}</h2><p>${esc(w.codigo_interno)} · DNI ${esc(w.dni)}</p><p>${esc(w.cargo||'Sin cargo')} · ${esc(w.area||'Sin área')}</p><p>${esc(w.email||'Correo sin registrar')}</p><p>${esc(w.telefono||'Teléfono sin registrar')}</p></article><button class="ios-btn ios-btn-primary" id="staff-scan-again">${icon('qr')} Escanear otra credencial</button><button class="ios-btn ios-btn-secondary staff-wide" id="staff-scan-done">Volver al equipo</button>`);root.querySelector('#staff-scan-again').onclick=startCardReader;root.querySelector('#staff-scan-done').onclick=()=>perform(()=>team());});};
 root.querySelector('#staff-code-form').onsubmit=e=>{e.preventDefault();const code=root.querySelector('#staff-code').value.trim();if(!code){root.querySelector('#staff-code').focus();return;}lookup(code);};
 try{const {QRScannerController}=await import('./scanner.js');if(generation!==readerGeneration||!root.querySelector('#staff-video'))return;const current=new QRScannerController(root.querySelector('#staff-video'),lookup,error=>{const status=root.querySelector('#staff-camera-status');if(status&&generation===readerGeneration)status.textContent=current.getFriendlyErrorMessage(error);});scanner=current;const result=await current.start();if(generation!==readerGeneration||scanner!==current){current.stop();return;}const status=root.querySelector('#staff-camera-status');if(status&&!result.cancelled)status.textContent=result.success?'Apunta al QR del fotocheck.':(result.message||'No se pudo abrir la cámara. Revisa su permiso o pega el enlace del QR.');}catch{const status=root.querySelector('#staff-camera-status');if(status&&generation===readerGeneration)status.textContent='No se pudo abrir la cámara. Revisa su permiso o pega el enlace del QR.';}
}
// ── Docente ──
function courses(){
 const course=(panel.cursos||[]).find(c=>Number(c.id)===selectedCourse);
 if(!course){content('Mis cursos',courseCards(panel.cursos||[]));bindCourses();return;}
 const students=panel.alumnos||[],notes=panel.notas||[],records=panel.asistencias||[];
 const notesOf=a=>notes.filter(n=>Number(n.matricula_curso_id)===Number(a.id));
 const courseAvg=average(notes.map(n=>n.nota)),att=attendanceStats(records);
 const studentRows=()=>{const q=norm(courseQuery);return students.filter(a=>!q||norm(a.apellido+' '+a.nombre+' '+a.nombre+' '+a.apellido).includes(q));};
 const gradesTable=list=>list.length?table(['Alumno','Notas por parcial','Promedio'],list.map(a=>{const own=notesOf(a),avg=average(own.map(n=>n.nota));return [esc(a.apellido+', '+a.nombre),own.map(n=>`<span class="staff-grade">P${esc(n.parcial)}: ${esc(n.nota)}</span>`).join(' ')||'Sin notas publicadas',avg===null?'—':`<span class="staff-grade staff-grade--avg">${fmtGrade(avg)}</span>`];})):empty(students.length?'Ningún alumno coincide con la búsqueda.':'No hay alumnos matriculados en este curso.');
 content(course.nombre,`<button class="staff-back" id="staff-course-back">${icon('chevron-left')} Todos mis cursos</button><p class="staff-subtitle">${esc(course.seccion)} · ${esc(course.periodo)} · ${esc(course.turno)}</p><section class="staff-stats staff-stats--compact"><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('users')}</span><span>Alumnos</span><strong>${students.length}</strong><small>En esta página</small></article><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('chart')}</span><span>Promedio del curso</span><strong>${fmtGrade(courseAvg)}</strong><small>${notes.filter(n=>numeric(n.nota)).length} nota(s) publicadas</small></article><article class="ios-card staff-stat"><span class="staff-stat__icon">${icon('circlecheck')}</span><span>Asistencia</span><strong>${att.rate===null?'—':att.rate+'%'}</strong><small>${att.total} registro(s) recientes</small></article></section><div class="staff-section-head"><h2>Alumnos y notas publicadas</h2>${students.length?`<button type="button" class="staff-link-btn" id="staff-copy-grades">${icon('clipboard')}Copiar notas</button>`:''}</div>${students.length?`<div class="staff-filter"><input id="staff-course-query" class="ios-input" type="search" maxlength="80" placeholder="Buscar alumno…" value="${esc(courseQuery)}" aria-label="Buscar alumno en el curso" autocomplete="off"></div>`:''}<div id="staff-course-grades">${gradesTable(studentRows())}</div><div class="staff-actions"><button class="ios-btn ios-btn-secondary" id="staff-course-prev" ${offset===0?'disabled':''}>Anterior</button><button class="ios-btn ios-btn-secondary" id="staff-course-next" ${panel.pagina?.siguiente==null?'disabled':''}>Siguiente</button></div><h2>Asistencias recientes</h2>${att.total?`<div class="staff-chips">${Object.entries(att.counts).map(([k,v])=>`<span class="staff-chip is-static">${badge(k)} <b>${v}</b></span>`).join('')}</div>`:''}${table(['Fecha','Alumno','Estado'],records.map(a=>{const u=students.find(s=>Number(s.id)===Number(a.matricula_curso_id));return [esc(a.fecha),esc(u?u.apellido+', '+u.nombre:'—'),badge(a.estado)||esc(a.estado)];}))}<p class="staff-subtitle">Consulta de los cursos que tienes asignados. El registro y la edición académica se gestionan en la intranet.</p>`);
 root.querySelector('#staff-course-back').onclick=()=>{selectedCourse=null;offset=0;courseQuery='';render();};root.querySelector('#staff-course-prev').onclick=()=>{offset=Math.max(0,offset-100);render();};root.querySelector('#staff-course-next').onclick=()=>{offset=panel.pagina.siguiente;render();};
 root.querySelector('#staff-course-query')?.addEventListener('input',e=>{courseQuery=e.target.value;root.querySelector('#staff-course-grades').innerHTML=gradesTable(studentRows());});
 root.querySelector('#staff-copy-grades')?.addEventListener('click',async()=>{
  const parciales=[...new Set(notes.map(n=>String(n.parcial)))].sort((a,b)=>Number(a)-Number(b));
  const text=[[`Alumno`,...parciales.map(p=>'P'+p),'Promedio'].join('\t'),...students.map(a=>{const own=notesOf(a),avg=average(own.map(n=>n.nota));return [`${a.apellido}, ${a.nombre}`,...parciales.map(p=>own.find(n=>String(n.parcial)===p)?.nota??''),avg===null?'':avg.toFixed(1)].join('\t');})].join('\n');
  await copyAndTell(text,'Notas copiadas: pégalas en Excel u Hojas de cálculo.');
 });
}
function schedule(){
 const items=panel.horarios||[];
 if(!items.length){content('Mi horario',empty('No tienes bloques de horario asignados.'));return;}
 const today=limaParts().day,current=todayClasses(),next=current.find(h=>h.state==='now')||current.find(h=>h.state==='next');
 const dayList=[1,2,3,4,5,6,7].filter(d=>items.some(h=>Number(h.dia)===d)&&(scheduleDay==='all'||d===today));
 const byDay=d=>items.filter(h=>Number(h.dia)===d).sort((a,b)=>(minutesOf(a.hora_inicio)??0)-(minutesOf(b.hora_inicio)??0));
 content('Mi horario',`${next?`<article class="ios-card staff-next"><span class="staff-eyebrow">${next.state==='now'?'En curso ahora':'Tu próxima clase de hoy'}</span><strong>${esc(next.curso)}</strong><small>${esc(timeRange(next.hora_inicio,next.hora_fin))} · ${esc(next.seccion)} · ${esc(next.aula||'Sin aula')}</small></article>`:''}<div class="staff-chips" role="group" aria-label="Filtrar horario"><button type="button" class="staff-chip" data-day="all" aria-pressed="${scheduleDay==='all'}">Semana</button><button type="button" class="staff-chip" data-day="today" aria-pressed="${scheduleDay==='today'}">Hoy · ${esc(days[today])}</button></div>${dayList.length?dayList.map(d=>`<h2 class="${d===today?'is-today':''}">${esc(days[d])}${d===today?' <span class="staff-badge staff-badge--info">Hoy</span>':''}</h2>${table(['Día','Hora','Curso / sección','Aula'],byDay(d).map(h=>[esc(days[Number(h.dia)]||'—'),esc(timeRange(h.hora_inicio,h.hora_fin)),esc(h.curso+' · '+h.seccion),esc(h.aula||'Sin aula')]))}`).join(''):empty('Hoy no tienes clases programadas.')}`);
 root.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{scheduleDay=b.dataset.day;schedule();});
}
// ── Perfil ──
function sessionInfo(){
 const session=staffSession();if(!session)return '';
 const left=Math.max(0,session.expires-Date.now()),h=Math.floor(left/3600000),m=Math.floor(left%3600000/60000);
 return `<article class="ios-card staff-session"><span class="staff-stat__icon">${icon('timer')}</span><div><strong>Sesión activa hasta las ${esc(clock(session.expires))}</strong><small>Quedan ${h?h+' h ':''}${m} min. Al vencer, vuelve a ingresar con tu cuenta.</small></div></article>`;
}
function permissionsInfo(){
 const entries=Object.entries(panel.permisos||{});if(!entries.length)return '';
 return `<h2>Permisos de tu cuenta</h2><ul class="ios-card staff-perms">${entries.map(([key,value])=>`<li class="${value?'is-on':'is-off'}">${icon(value?'circlecheck':'circlex')}<span>${esc(permissionNames[key]||humanize(key))}</span><small>${value?'Permitido':'Sin acceso'}</small></li>`).join('')}</ul>`;
}
function profile(){
 const u=panel.identidad,server=studentServerInfo();
 content('Perfil',`<article class="ios-card staff-person staff-profile">${avatar(u.nombre)}<div><h2>${esc(u.nombre)}</h2><p>${esc(roleNames[u.rol]||u.rol)} · ${u.origen==='intranet'?'Intranet':'Asistencia'}</p>${u.dni?`<p>DNI ${esc(u.dni)}</p>`:''}<p>${esc(u.email||'Correo sin registrar')}</p>${u.telefono?`<p>${esc(u.telefono)}</p>`:''}</div></article>${sessionInfo()}${permissionsInfo()}<h2>Apariencia</h2><div class="ios-card staff-theme">${[['system','Sistema'],['light','Claro'],['dark','Oscuro']].map(([key,label])=>`<button class="ios-btn ios-btn-secondary" data-staff-theme="${key}" aria-pressed="${getThemePreference()===key}">${icon(key==='dark'?'moon':key==='light'?'sun':'smartphone')} ${label}</button>`).join('')}</div>${server?`<button class="ios-card staff-shortcut" id="staff-server">${icon('server')}<span>Servidor<small>${esc(server.label)}</small></span>${icon('chevron-right')}</button>`:''}<p class="staff-subtitle">La sesión de este panel requiere conexión y vence a las 8 horas. Los cambios de rol, contraseña o permisos se comprueban en el servidor.</p><button class="ios-btn ios-btn-secondary" id="staff-logout">${icon('logout')} Cerrar sesión</button><p class="staff-version">Instituto IDEAS · v${esc(APP_VERSION)}</p>`);
 root.querySelectorAll('[data-staff-theme]').forEach(b=>b.onclick=()=>{setThemePreference(b.dataset.staffTheme);profile();});root.querySelector('#staff-server')?.addEventListener('click',openStudentServerSettings);
 root.querySelector('#staff-logout').onclick=async()=>{const choice=await showActionSheet({title:'¿Cerrar sesión?',message:'Podrás volver a entrar con tu DNI o usuario y tu contraseña.',actions:[{label:'Cerrar sesión',value:'logout',style:'destructive'}]});if(choice!=='logout')return;const button=root.querySelector('#staff-logout');if(button){button.disabled=true;button.textContent='Cerrando sesión…';}staffLogout().catch(()=>{});};
}
function showNotice(message){content('Aviso',`<p class="staff-empty" role="status">${esc(message)}</p><button class="ios-btn ios-btn-secondary" id="staff-retry">Volver</button>`);root.querySelector('#staff-retry').onclick=()=>render();}
function expirePanel(){
 sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);clearTimeout(warnTimer);panel=null;forgetStaffSession();
 root.innerHTML='<h1>Sesión finalizada</h1>'+empty('Tu sesión venció o tus permisos cambiaron. Vuelve a ingresar.')+'<button id="staff-login" class="ios-btn ios-btn-primary">Iniciar sesión</button>';
 const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';root.querySelector('#staff-login').onclick=()=>location.reload();
}
function handleAccountChange(event){
 if((event.key!==null&&event.key!=='ideas-personal-session:v1')||event.oldValue===event.newValue)return;
 sequence++;controller?.abort();stopCamera();clearTimeout(timer);clearTimeout(expiryTimer);clearTimeout(warnTimer);panel=null;
 root.innerHTML=empty('La cuenta cambió. Abriendo la sesión actual…');const nav=document.getElementById('bottom-nav');nav.hidden=true;nav.innerHTML='';location.reload();
}
function scheduleSessionExpiry(){
 clearTimeout(expiryTimer);clearTimeout(warnTimer);const session=staffSession();if(!session){expirePanel();return;}
 // Aviso 10 minutos antes de que venza, para no perder lo que se está consultando.
 const warnIn=session.expires-Date.now()-600000;
 if(warnIn>0)warnTimer=setTimeout(()=>{if(staffSession())showToast('Tu sesión vence en 10 minutos. Luego tendrás que volver a ingresar.','warning',8000);},warnIn);
 expiryTimer=setTimeout(()=>{if(staffSession())scheduleSessionExpiry();else expirePanel();},Math.max(1,session.expires-Date.now()+20));
}
async function perform(action){try{await action();}catch(e){if(e.cancelled)return;if(!staffSession()||e.status===401){expirePanel();return;}showNotice(e.message||'No se pudo consultar el servidor.');}}
function skeleton(){return `<div class="staff-loading" role="status" aria-label="Consultando tu panel"><p class="staff-empty">Consultando tu panel…</p><div class="staff-skeleton staff-skeleton--title"></div><div class="staff-skeleton-grid"><div class="staff-skeleton"></div><div class="staff-skeleton"></div></div><div class="staff-skeleton staff-skeleton--wide"></div></div>`;}
// silent: actualización en segundo plano; conserva lo que se ve (y el desplazamiento) hasta tener datos nuevos.
async function render({silent=false}={}){
 if(!staffSession()){expirePanel();return;}
 const focusedInput=root.contains(document.activeElement)&&/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
 if(silent&&(scanner||focusedInput||!panel||!['home','profile','schedule'].includes(route()))){scheduleRefresh();return;}
 stopCamera();clearTimeout(timer);if(!silent){root.innerHTML=skeleton();root.scrollTop=0;}
 busy=true;root.querySelector('.staff-refresh')?.setAttribute('disabled','');
 silentPaint=silent;
 await perform(async()=>{try{panel=await load('panel',{curso:route()==='courses'?selectedCourse:null,offset});}catch(e){if(e.status!==404||route()!=='courses'||selectedCourse===null)throw e;selectedCourse=null;offset=0;panel=await load('panel',{curso:null,offset:0});showToast('El curso ya no está disponible en tus asignaciones.','info');}lastUpdated=Date.now();busy=false;const allowed=tabList().map(t=>t[0]);if(!allowed.includes(route())){location.hash='#home';return;}
  if(route()==='students')await students();else if(route()==='team')await team();else if(route()==='courses')courses();else if(route()==='schedule')schedule();else if(route()==='profile')profile();else home();
 });
 silentPaint=false;busy=false;root.querySelector('.staff-refresh')?.removeAttribute('disabled');
 scheduleRefresh();
}
// Inicio y horario se actualizan solos cada minuto mientras la app está visible.
function scheduleRefresh(){clearTimeout(timer);if(!document.hidden)timer=setTimeout(()=>{if(['home','schedule'].includes(route()))render({silent:true});},60000);}
export async function initStaffApp(){
 initTheme();useProfileServerControls();document.body.classList.add('student-mode','staff-mode');document.body.classList.remove('no-bottom-nav');document.getElementById('ios-install-banner')?.remove();
 if('serviceWorker' in navigator&&location.hostname!=='appassets.androidplatform.net')navigator.serviceWorker.ready.then(reg=>{
  if(reg.scope!==new URL('../',import.meta.url).href)return;let announced=false;
  const announce=()=>{if(announced||!navigator.serviceWorker.controller)return;announced=true;showToast('Hay una versión nueva. Cierra todas las pestañas de esta app y vuelve a abrirla para actualizar.','info',12000);};
  if(reg.waiting)announce();const watch=()=>{const worker=reg.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')announce();});};reg.addEventListener('updatefound',watch);watch();
 }).catch(()=>{});
 const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('../css/staff-app.css?v=2',import.meta.url).href;document.head.append(style);
 document.getElementById('app-view').innerHTML='<section class="view view--tab student-view staff-view"></section>';root=document.querySelector('.staff-view');
 window.addEventListener('storage',handleAccountChange);window.addEventListener('hashchange',()=>render());document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();clearTimeout(timer);controller?.abort();}else if(root.querySelector('#staff-video'))startCardReader();else render({silent:Boolean(panel)});});window.addEventListener('online',()=>render({silent:Boolean(panel)}));window.addEventListener('offline',()=>{const line=root.querySelector('.staff-status');if(line)line.outerHTML=statusLine();});window.addEventListener('beforeunload',stopCamera);
 window.__androidBack=()=>{if(dismissOpenSheet())return 'handled';if(scanner){stopCamera();render();return 'handled';}if(route()!=='home'){location.hash='#home';return 'handled';}return 'exit';};
 const detected=consumeDetectedAccount();
 scheduleSessionExpiry();await render();
 if(detected)showToast('Cuenta detectada: '+detected,'success');
}
// Hoja de acciones abierta (Copiar reporte, Cerrar sesión): Atrás la cierra antes de cambiar de pantalla.
function dismissOpenSheet(){if(dismissTopSheet())return true;const cancel=document.querySelector('.sheet-backdrop--action:not([hidden]) [data-cancel]');if(cancel){cancel.click();return true;}return false;}
