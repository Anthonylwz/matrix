// Asistencia del alumno: escanea el QR de la pantalla del instituto (o escribe su código) y valida la ubicación.
// Sin conexión (o con el servidor caído) la marca se guarda en el teléfono y se envía sola al volver la red.
// El servidor decide a qué clase corresponde la marca según el horario del alumno.
import { studentRequest, studentSession } from './student-api.js';
import { createMarkQueue } from './student-mark-queue.js';
import { currentEnrollmentSchedule } from './student-model.js';
import { getLocationForMark, locationErrorMessage, startLocation, stopLocation } from './location.js';
import { openSheet, dismissSheet, closeSheet } from './sheet.js';
import { icon, rowIcon } from './icons.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateLabels={presente:'Presente',tardanza:'Tardanza',falta:'Falta',justificada:'Justificada',por_marcar:'Por marcar',pendiente:'Pendiente',sin_registro:'Sin registro'};
const stateIcons={presente:['circlecheck','green'],tardanza:['clock','orange'],falta:['circlealert','red'],justificada:['circlecheck','blue'],por_marcar:['scan','blue'],pendiente:['calendar','gray'],sin_registro:['circlealert','red']};
const ANTICIPO_MIN=20;
const fmtDate=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));return m?`${m[3]}/${m[2]}/${m[1]}`:'';};
let scanner=null,marking=false,activeSheet=null,generation=0,calMonth=null,calDay=null;

// ── Hora de Lima ──
const pad=n=>String(n).padStart(2,'0');
function limaParts(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return {y:+parts.year,m:+parts.month,d:+parts.day,h:+parts.hour,i:+parts.minute,s:+parts.second};
}
const limaStamp=(date=new Date())=>{const p=limaParts(date);return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.i)}:${pad(p.s)}`;};
const limaToday=()=>limaStamp().slice(0,10);
const isoWeekday=iso=>{const [y,m,d]=iso.split('-').map(Number);return ((new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7)+1;};
const toMinutes=value=>{const m=/^(\d{2}):(\d{2})/.exec(String(value||''));return m?+m[1]*60+ +m[2]:null;};

// ── Cola de marcas sin conexión ──
const queue=createMarkQueue(studentSession,localStorage);
const loadQueue=()=>queue.read();
export const pendingMarkCount=()=>loadQueue().length;
const enqueue=(payload,capturedAt)=>queue.enqueue(payload,capturedAt);
export const syncPendingMarks=()=>navigator.onLine===false?Promise.resolve({sent:[],rejected:[],remaining:pendingMarkCount()}):queue.sync(studentRequest);

// ── Datos de hoy (se recalculan con la hora del teléfono: la caché puede ser de otro momento) ──
export function attendanceSummary(data){
  const a=data?.asistencia;
  return {hoy:Array.isArray(a?.hoy)?a.hoy:[],historial:Array.isArray(a?.historial)?a.historial:[],resumen:a?.resumen||{presentes:0,tardanzas:0},fecha:a?.fecha||null,desde:a?.desde||null};
}
function todayClasses(data){
  const {hoy,historial,fecha}=attendanceSummary(data),today=limaToday(),p=limaParts(),minute=p.h*60+p.i;
  let classes;
  if(fecha===today)classes=hoy.map(c=>({...c}));
  else{
    const day=isoWeekday(today),marks=historial.filter(h=>h.fecha===today);
    classes=currentEnrollmentSchedule(data,Array.isArray(data?.horarios)?data.horarios:[]).filter(h=>Number(h.dia)===day).map(h=>{
      const m=marks.find(x=>Number(x.horario_id)===Number(h.id));
      return {horario_id:h.id,curso:h.curso,aula:h.aula,hora_inicio:String(h.hora_inicio).slice(0,5),hora_fin:String(h.hora_fin).slice(0,5),estado:m?m.estado:'pendiente',hora_marca:m?m.hora:null};
    }).sort((a,b)=>a.hora_inicio.localeCompare(b.hora_inicio));
  }
  return classes.map(c=>{
    if(['presente','tardanza','falta','justificada'].includes(c.estado))return c;
    const start=toMinutes(c.hora_inicio),end=toMinutes(c.hora_fin);
    if(start===null||end===null)return c;
    return {...c,estado:minute>=end?'sin_registro':minute>=start-ANTICIPO_MIN?'por_marcar':'pendiente'};
  });
}
export const pendingMarks=data=>todayClasses(data).filter(c=>c.estado==='por_marcar');

// ── Calendario de asistencias ──
function dayStatuses(data){
  const {historial}=attendanceSummary(data);
  const byDay=new Map();historial.forEach(h=>{const list=byDay.get(h.fecha)||[];list.push(h);byDay.set(h.fecha,list);});
  return iso=>{
    const records=byDay.get(iso);
    if(records)return {status:['falta','tardanza','justificada','presente'].find(state=>records.some(r=>r.estado===state))||'',records};
    // El horario semanal actual y un historial de 500 marcas no prueban una falta histórica.
    return {status:'',records:[]};
  };
}
const monthTitle=(y,m)=>{const t=new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,1)));return t.charAt(0).toUpperCase()+t.slice(1);};
function calendarMarkup(data){
  const today=limaToday(),status=dayStatuses(data);
  if(!calMonth)calMonth=today.slice(0,7);
  const [y,m]=calMonth.split('-').map(Number),first=isoWeekday(`${y}-${pad(m)}-01`),days=new Date(Date.UTC(y,m,0)).getUTCDate();
  const selected=calDay&&calDay.startsWith(calMonth)?calDay:(today.startsWith(calMonth)?today:null);
  let present=0,late=0;const cells=[];
  for(let i=1;i<first;i++)cells.push('<span class="sa-cal__blank"></span>');
  for(let d=1;d<=days;d++){
    const iso=`${y}-${pad(m)}-${pad(d)}`,info=status(iso),future=iso>today;
    if(info.status==='presente')present++;else if(info.status==='tardanza')late++;
    const label=`${d} de ${monthTitle(y,m).split(' ')[0]}${info.status?': '+stateLabels[info.status]:''}`;
    cells.push(`<button type="button" class="sa-cal__day${info.status?' sa-cal__day--'+info.status:''}${iso===today?' is-today':''}${iso===selected?' is-selected':''}" data-cal-day="${iso}" aria-label="${esc(label)}" aria-pressed="${iso===selected}" ${future?'disabled':''}>${d}</button>`);
  }
  const nowMonth=today.slice(0,7),minDate=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-13,1)),minMonth=`${minDate.getUTCFullYear()}-${pad(minDate.getUTCMonth()+1)}`;
  let detail='';
  if(selected){
    const info=status(selected),classes=selected===today?todayClasses(data):[];
    const rows=info.records.length?info.records.map(r=>`<div class="list-row">${rowIcon(...(stateIcons[r.estado]||stateIcons.pendiente))}<span class="list-row__main"><span>${esc(r.curso)}</span><span class="list-row__sub">${r.hora?'Marcaste a las '+esc(r.hora):'Registrada en la intranet'}</span></span><span class="list-row__end"><small class="sa-pay-badge sa-att-badge--${esc(r.estado)}">${stateLabels[r.estado]||esc(r.estado)}</small></span></div>`).join(''):
      `<div class="list-row">${rowIcon('calendar','gray')}<span class="list-row__main"><span>${selected===today&&classes.length?'Aún no has marcado hoy':'Sin registros disponibles'}</span><span class="list-row__sub">${selected===today&&classes.length?'Consulta el estado de tus clases de hoy.':'El historial disponible no confirma una falta ni si hubo clases ese día.'}</span></span></div>`;
    detail=`<div class="list-header">${esc(fmtDate(selected))}</div><div class="ios-card ios-card--flush list-group--icons">${rows}</div>`;
  }
  return `<section class="ios-card sa-cal" aria-label="Calendario de asistencias"><div class="sa-cal__head"><button type="button" class="nav-btn" data-cal-nav="-1" aria-label="Mes anterior" ${calMonth<=minMonth?'disabled':''}><span aria-hidden="true">‹</span></button><h3>${esc(monthTitle(y,m))}</h3><button type="button" class="nav-btn" data-cal-nav="1" aria-label="Mes siguiente" ${calMonth>=nowMonth?'disabled':''}><span aria-hidden="true">›</span></button></div>
    <div class="sa-cal__grid" role="group" aria-label="Días del mes">${['L','M','M','J','V','S','D'].map(d=>`<span class="sa-cal__dow" aria-hidden="true">${d}</span>`).join('')}${cells.join('')}</div>
    <div class="sa-cal__legend"><span><i class="sa-dot sa-dot--presente"></i>Días a tiempo ${present}</span><span><i class="sa-dot sa-dot--tardanza"></i>Días con tardanza ${late}</span></div></section>${detail}`;
}

function classRow(c){
  const [symbol,color]=stateIcons[c.estado]||stateIcons.pendiente;
  const sub=[`${c.hora_inicio}–${c.hora_fin}`,c.aula?'Aula '+c.aula:'',c.hora_marca?'Marcaste a las '+c.hora_marca:''].filter(Boolean).join(' · ');
  return `<div class="list-row">${rowIcon(symbol,color)}<span class="list-row__main"><span>${esc(c.curso)}</span><span class="list-row__sub">${esc(sub)}</span></span><span class="list-row__end"><small class="sa-pay-badge sa-att-badge--${esc(c.estado)}">${stateLabels[c.estado]||esc(c.estado)}</small></span></div>`;
}

export function attendanceMarkup(data){
  const hoy=data?todayClasses(data):[],queue=loadQueue();
  const ready=!data||hoy.some(c=>c.estado==='por_marcar');
  const hint=!data?'Aunque no haya conexión, puedes marcar: se guardará y se enviará sola cuando vuelva la red.':!hoy.length?'Hoy no tienes clases en tu horario.':hoy.some(c=>c.estado==='por_marcar')?'Tu clase está por empezar o en curso. Marca con el QR de la pantalla del instituto.':hoy.every(c=>['presente','tardanza','falta','justificada'].includes(c.estado))?'Todas tus clases de hoy tienen un registro de asistencia.':'Podrás marcar 20 minutos antes de cada clase.';
  const pending=queue.length?`<section class="ios-card sa-pending" role="status"><div><strong>${queue.length} marca${queue.length>1?'s':''} guardada${queue.length>1?'s':''} sin enviar</strong><p>${esc(queue.map(i=>i.capturado_en.slice(11,16)+' ('+fmtDate(i.capturado_en.slice(0,10))+')').join(' · '))}. Se enviarán solas al recuperar la conexión.</p></div><button type="button" class="ios-btn ios-btn-secondary ios-btn--sm" id="student-sync-now">Enviar ahora</button></section>`:'';
  const today=hoy.length?`<div class="list-header">Clases de hoy</div><div class="ios-card ios-card--flush list-group--icons">${hoy.map(classRow).join('')}</div>`:'';
  const summary=attendanceSummary(data).resumen;
  return `<section class="ios-card sa-att-hero" aria-label="Marcar asistencia"><div class="sa-att-hero__text"><span class="sa-eyebrow">ASISTENCIA</span><h2>${ready?'Marca tu asistencia':'Tu asistencia de hoy'}</h2><p>${esc(hint)}</p></div><button type="button" class="ios-btn ios-btn-primary sa-att-btn" id="student-mark-open" ${ready?'':'disabled'}>${icon('scan')}<span>Marcar asistencia</span></button></section>
    ${pending}
    <div class="sa-stats"><div class="stat-tile"><span class="sa-stat-icon">${icon('circlecheck')}</span><strong>${Number(summary.presentes)||0}</strong><span>Presentes</span></div><div class="stat-tile"><span class="sa-stat-icon">${icon('clock')}</span><strong>${Number(summary.tardanzas)||0}</strong><span>Tardanzas</span></div></div>
    <p class="sa-caption">Tus totales incluyen todas las asistencias registradas, sin filtro de periodo académico. Los colores del calendario cuentan días con registros disponibles; un día sin color no confirma una falta.</p>
    ${today}${calendarMarkup(data)}
    <div id="student-mark-sheet" class="sheet-backdrop" hidden><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="student-mark-title" tabindex="-1"><div class="sheet__grabber"></div><div class="sheet__nav"><button type="button" class="nav-btn nav-btn--text" data-mark-close>Cerrar</button><h3 class="sheet__nav-title" id="student-mark-title">Marcar asistencia</h3><span class="sa-att-spacer"></span></div>
      <div class="sa-scan"><div class="sa-scan-frame"><video id="student-mark-video" playsinline muted autoplay></video><span class="sa-scan-guide" aria-hidden="true"></span></div>
      <p id="student-mark-status" class="sa-form-status" role="status" aria-live="polite">Apunta al QR de la pantalla del instituto.</p>
      <form id="student-mark-form" class="sa-code-form" autocomplete="off"><label class="ios-label" for="student-mark-code">¿No puedes escanear? Escribe el código</label><div class="sa-code-row"><input id="student-mark-code" class="ios-input" inputmode="numeric" autocomplete="one-time-code" maxlength="12" pattern="[0-9]{4,12}" placeholder="Código de 6 dígitos"><button type="submit" class="ios-btn ios-btn-primary">Marcar</button></div></form></div></div></div>`;
}

export function bindAttendance(root,{onMarked,onQueued,onIdle,onCalendar,onSync}={}){
  root.querySelectorAll('[data-cal-nav]').forEach(button=>button.addEventListener('click',()=>{
    const [y,m]=(calMonth||limaToday().slice(0,7)).split('-').map(Number),next=new Date(Date.UTC(y,m-1+Number(button.dataset.calNav),1));
    calMonth=`${next.getUTCFullYear()}-${pad(next.getUTCMonth()+1)}`;calDay=null;onCalendar?.();
  }));
  root.querySelectorAll('[data-cal-day]').forEach(button=>button.addEventListener('click',()=>{calDay=button.dataset.calDay;onCalendar?.();}));
  root.querySelector('#student-sync-now')?.addEventListener('click',()=>onSync?.());

  const open=root.querySelector('#student-mark-open'),sheet=root.querySelector('#student-mark-sheet');
  if(!open||!sheet)return;
  const video=sheet.querySelector('#student-mark-video'),status=sheet.querySelector('#student-mark-status'),form=sheet.querySelector('#student-mark-form'),code=sheet.querySelector('#student-mark-code');
  let marked=null,queued=false,resumeTimer=null;
  const setStatus=(text,alert=false)=>{status.textContent=text;status.setAttribute('role',alert?'alert':'status');};
  const setBusy=value=>{marking=value;form.querySelectorAll('input,button').forEach(el=>el.disabled=value);};

  async function stopScanner(){generation++;try{scanner?.stop();}catch{}scanner=null;stopLocation();}
  async function submit(payload,sheetEl){
    if(marking)return;const mine=++generation,capturedAt=limaStamp();setBusy(true);
    try{
      try{scanner?.pause();}catch{}
      setStatus('Verificando tu ubicación…');
      const fix=await getLocationForMark();
      if(mine!==generation)return;
      if(fix.error){throw Object.assign(new Error(locationErrorMessage(fix.error)||'No se pudo obtener tu ubicación.'),{retry:true});}
      // El GPS o un timeout no deben cambiar la clase ni la validez del QR capturado.
      const body={...payload,...fix.coords,capturado_en:capturedAt};
      let result=null;
      if(navigator.onLine===false){enqueue(body,capturedAt);queued=true;}
      else{
        setStatus('Registrando asistencia…');
        try{result=await studentRequest('marcar_asistencia',body);}
        catch(error){if(error?.offline){enqueue(body,capturedAt);queued=true;}else throw error;}
      }
      if(mine!==generation)return;
      await stopScanner();
      await closeSheet(sheetEl);activeSheet=null;
      marked=result;
    }catch(error){
      if(mine!==generation)return;
      setStatus(error.message||'No se pudo registrar la asistencia.',true);
      // No se reanuda al instante: con el QR aún frente a la cámara se reenviaría en bucle y bloquearía al alumno.
      clearTimeout(resumeTimer);resumeTimer=setTimeout(()=>{try{if(activeSheet&&!marking)scanner?.resume();}catch{}},error?.retry?1500:5000);
    }finally{setBusy(false);}
    if(queued){queued=false;onQueued?.();}
    else if(marked){const result=marked;marked=null;onMarked?.(result);}
  }
  async function begin(){
    if(activeSheet||marking)return;activeSheet=sheet;form.reset();setStatus('Iniciando cámara…');
    openSheet(sheet,{focus:sheet.querySelector('[data-mark-close]'),canDismiss:()=>!marking,onClose:()=>{clearTimeout(resumeTimer);stopScanner();activeSheet=null;onIdle?.();}});
    startLocation();
    const mine=++generation;
    try{
      const {QRScannerController}=await import('./scanner.js');
      if(mine!==generation||!activeSheet)return;
      scanner=new QRScannerController(video,decoded=>{if(!marking)submit({token_qr:String(decoded).slice(0,512)},sheet);},()=>{});
      const result=await scanner.start();
      if(mine!==generation)return;
      if(result?.success)setStatus('Apunta al QR de la pantalla del instituto.');
      else if(!result?.cancelled)setStatus(result?.message||'No se pudo iniciar la cámara. Escribe el código de la pantalla.',true);
    }catch{setStatus('No se pudo iniciar la cámara. Escribe el código de la pantalla.',true);}
  }
  open.addEventListener('click',begin);
  sheet.querySelector('[data-mark-close]').addEventListener('click',()=>{if(!marking)dismissSheet(sheet);});
  form.addEventListener('submit',event=>{event.preventDefault();const value=code.value.trim();if(!/^[0-9]{4,12}$/.test(value)){setStatus('Escribe el código numérico de la pantalla.',true);return;}submit({codigo:value},sheet);});
}

export const attendanceBusy=()=>marking;
export const attendanceSheetOpen=()=>Boolean(activeSheet);
