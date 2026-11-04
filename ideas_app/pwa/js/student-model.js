// Funciones puras compartidas por las vistas; no dependen del DOM ni de la sesión.
export const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
export function matchesSearch(values, query) {
  const haystack = normalizeSearch(values.join(' '));
  return normalizeSearch(query).split(/\s+/).every(term => haystack.includes(term));
}
export function sortClasses(items) {
  return [...items].sort((a,b) => Number(a.dia)-Number(b.dia) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)) || String(a.curso).localeCompare(String(b.curso),'es'));
}
export function shouldAutoRefresh({ loading, loggingOut, lastSuccess, lastAttempt = 0, now = Date.now() }) {
  const latest = Math.max(lastSuccess || 0, lastAttempt);
  return !loading && !loggingOut && (!latest || now-latest >= 60000);
}
export function academicPeriods(data) {
  return [...new Set(['matriculas','cursos','horarios','evaluaciones','pagos','pagos_historial'].flatMap(key => (data?.[key] || []).map(item => String(item.periodo || ''))).filter(Boolean))];
}
export function primaryEnrollment(data) {
  const rank={matriculado:0,pendiente_pago:1,finalizado:2,anulado:3};
  return [...(data?.matriculas||[])].sort((a,b)=>(rank[a.estado]??4)-(rank[b.estado]??4)||String(b.fecha_matricula||'').localeCompare(String(a.fecha_matricula||''))||Number(b.id||0)-Number(a.id||0))[0]||null;
}
export function defaultPeriod(data) {
  return String(primaryEnrollment(data)?.periodo || academicPeriods(data)[0] || '');
}
export function inPeriod(items, period) {
  return period === '*' ? items : items.filter(item => String(item.periodo || '') === period);
}
// El periodo no identifica una matrícula: puede haber una finalizada y otra vigente del mismo periodo.
export function currentEnrollmentSchedule(data, items = data?.horarios || [], now = new Date()) {
  const enrollments=Array.isArray(data?.matriculas)?data.matriculas:[];
  const activeIds=new Set(enrollments.filter(m=>m.estado==='matriculado').map(m=>String(m.id)));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(now);
  return items.filter(h=>{
    if(h.fecha_inicio&&h.fecha_inicio>today||h.fecha_fin&&h.fecha_fin<today)return false;
    if(h.matricula_id!==undefined&&h.matricula_id!==null)return activeIds.has(String(h.matricula_id))&&(!h.estado_matricula||h.estado_matricula==='matriculado');
    if(h.estado_matricula)return h.estado_matricula==='matriculado';
    const samePeriod=enrollments.filter(m=>String(m.periodo||'')===String(h.periodo||''));
    // En cachés antiguas sin ID no se adivina a qué matrícula pertenece un horario ambiguo.
    return samePeriod.length>0&&samePeriod.every(m=>m.estado==='matriculado');
  });
}
const cents=value=>Math.round((Number(value)||0)*100);
export function paymentNet(o) { return Math.max(0,cents(o.monto_total)-cents(o.descuento))/100; }
export function paymentState(o,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date())) {
  if(cents(o.saldo)<=0)return 'pagado';
  if(o.estado==='En revision')return 'revision';
  if(o.vence&&o.vence<today)return 'vencido';
  return cents(o.pagado)>0?'parcial':'pendiente';
}
export function paymentTotals(items,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date())) {
  const open=items.filter(o=>paymentState(o,today)!=='pagado');
  const overdue=open.filter(o=>paymentState(o,today)==='vencido');
  const review=open.filter(o=>paymentState(o,today)==='revision');
  const next=open.filter(o=>o.vence&&o.vence>=today&&paymentState(o,today)!=='revision').sort((a,b)=>String(a.vence).localeCompare(String(b.vence)))[0]||null;
  return {open,overdue,review,next,debt:open.reduce((sum,o)=>sum+cents(o.saldo),0)/100};
}
export function limaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part = type => parts.find(p => p.type === type)?.value;
  return {day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(part('weekday'))+1,minute:Number(part('hour'))*60+Number(part('minute'))};
}
function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value));
  if(!match || Number(match[1])>23 || Number(match[2])>59)return null;
  return Number(match[1])*60+Number(match[2]);
}
export function nextWeeklyClass(items, now = new Date()) {
  const clock = limaClock(now);
  return items.flatMap(item => {
    const start=timeMinutes(item.hora_inicio),end=timeMinutes(item.hora_fin),day=Number(item.dia);
    if(!Number.isInteger(day)||day<1||day>7||start===null||end===null||end<=start)return [];
    const active=day===clock.day&&clock.minute>=start&&clock.minute<end;
    let wait=(day-clock.day)*1440+start-clock.minute;
    if(wait<0)wait+=10080;
    return [{item,active,wait:active?0:wait}];
  }).sort((a,b)=>a.wait-b.wait)[0] || null;
}
