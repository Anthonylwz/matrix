import { studentRequest, studentSession } from './student-api.js';
import { getNativeServerBase, getServerKey } from './server-context.js';
import { icon, rowIcon } from './icons.js';
import { showToast, ICON_CHEVRON } from './utils.js';

const KEY='ideas-student-push-registration';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let permissionTimer=null,registrationDirty=false;
let initialized=false,inFlight=null,listFlight=null,epoch=0,lastList=0,items=[],listError='',loaded=false,sending=null;
const bridge=()=>window.AndroidNet;
const permission=()=>{try{return Boolean(bridge()?.notificationsAllowed?.());}catch{return false;}};
const owner=()=>{const s=studentSession();return s?`${getServerKey()}|${s.alumno_id}`:'';};
const preference=()=>{try{return localStorage.getItem('ideas-push-choice:'+owner())!=='off';}catch{return true;}};
const changed=()=>window.dispatchEvent(new Event('student:push-updated'));
const sessionToken=()=>localStorage.getItem('asistencia_token')||'';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function studentPushRoute(destination){
  const d=String(destination||'').split('?')[0];
  return '#'+(['home','studies','schedule','attendance','pagos','profile'].includes(d)?d:'notifications');
}
export function bindStudentNativeSession(){
  const s=studentSession();if(!s||!sessionToken())return false;
  if(!preference()){try{bridge()?.clearSessionContext?.();}catch{}return true;}
  try{return bridge()?.setSessionContext?.(getNativeServerBase(),'alumno:'+s.alumno_id,sessionToken())===true;}catch{return false;}
}
export async function registerStudentPush(){
  if(inFlight){registrationDirty=true;return inFlight;}
  if(!studentSession()||!bridge()?.getFcmToken)return;
  const revision=epoch,identity=owner(),session=sessionToken();
  const run=async()=>{
    if(!bindStudentNativeSession())return;
    const fcm=String(bridge().getFcmToken()||'');if(!fcm)return;
    const enabled=permission()&&preference();
    const marker=identity+'|'+await digest(session)+'|'+await digest(fcm)+'|'+enabled;
    const current=()=>revision===epoch&&identity===owner()&&session===sessionToken()&&fcm===bridge().getFcmToken()&&enabled===(permission()&&preference());
    if(!current())return;
    try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.marker===marker&&Date.now()-saved.time<86400000&&Date.now()>=saved.time){sending=saved.configured;return;}}catch{}
    let info={};try{info=JSON.parse(bridge().getAppInfo()||'{}');}catch{}
    const result=await studentRequest('push_registrar',{fcm_token:fcm,habilitado:enabled,app_version:String(info.version||''),android_sdk:Number(info.sdk||0)});
    if(!current())return;
    sending=Boolean(result.envio_configurado);
    try{localStorage.setItem(KEY,JSON.stringify({marker,time:Date.now(),configured:sending}));}catch{}
    changed();
  };
  inFlight=run().catch(()=>{/* Reintenta al volver a abrir; no guarda falsos éxitos. */}).finally(()=>{inFlight=null;if(registrationDirty){registrationDirty=false;return registerStudentPush();}});
  return inFlight;
}
export async function loadStudentNotices(force=false){
  if(listFlight)return listFlight;
  if(!studentSession()||(!force&&Date.now()-lastList<60000))return;
  const identity=owner(),session=sessionToken(),revision=epoch;
  listFlight=(async()=>{
    try{const result=await studentRequest('avisos');if(identity!==owner()||session!==sessionToken()||revision!==epoch)return;
      items=Array.isArray(result.avisos)?result.avisos:[];sending=Boolean(result.envio_configurado);loaded=true;listError='';lastList=Date.now();
    }catch(e){if(identity===owner()&&revision===epoch)listError=e.message;}
    finally{listFlight=null;changed();}
  })();return listFlight;
}
async function pending(){
  if(!bindStudentNativeSession())return;
  try{
    const destination=bridge()?.takePendingDestination?.();const id=Number(bridge()?.takePendingNotificationId?.()||0);
    if(!destination)return;
    location.hash=studentPushRoute(destination);
    if(id>0)studentRequest('avisos_leer',{notificacion_id:id}).then(()=>loadStudentNotices(true)).catch(()=>{});
    else loadStudentNotices(true);
  }catch{/* El aviso se conserva en la bandeja aunque no se pueda confirmar la apertura. */}
}
export function initStudentPush(){
  if(initialized)return;initialized=true;
  // Los recordatorios de salida corresponden a trabajadores, no a una sesión académica.
  try{bridge()?.setExitReminder?.(false,'');}catch{}
  bindStudentNativeSession();registerStudentPush();loadStudentNotices();pending();
  window.addEventListener('android:fcmtoken',registerStudentPush);
  window.addEventListener('android:notification',()=>{pending();loadStudentNotices(true);});
  window.addEventListener('student:session-ended',()=>{epoch++;registrationDirty=false;items=[];loaded=false;lastList=0;sending=null;});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){registerStudentPush();pending();loadStudentNotices();}});
  window.addEventListener('focus',()=>{registerStudentPush();loadStudentNotices();});
  window.addEventListener('online',()=>{registerStudentPush();loadStudentNotices();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#notifications')loadStudentNotices(true);});
}
export function studentPushSettingsMarkup(){
  const native=typeof bridge()?.getFcmToken==='function';
  const status=!native?'Consulta los avisos en tu bandeja':!permission()?'Permiso de Android desactivado':!preference()?'Alertas desactivadas':sending===false?'Avisos en la app · alertas externas pendientes':'Alertas de tu cuenta de alumno';
  return `<div class="list-header">Notificaciones</div><div class="ios-card ios-card--flush list-group--icons"><a href="#notifications" class="list-row">${rowIcon('bell','orange')}<span class="list-row__main"><span>Mis avisos</span><span class="list-row__sub">${items.filter(n=>!n.leida_en).length} sin leer</span></span><span class="list-row__end">${ICON_CHEVRON}</span></a>${native?`<button type="button" id="student-push-toggle" class="list-row">${rowIcon('bell','blue')}<span class="list-row__main"><span>${permission()&&preference()?'Desactivar alertas':'Activar alertas'}</span><span class="list-row__sub">${escape(status)}</span></span><span class="list-row__end">${ICON_CHEVRON}</span></button>`:''}</div>`;
}
export function studentNoticesMarkup(){
  const error=listError?`<div class="ios-card" role="status"><p>${escape(listError)}</p><button type="button" class="ios-btn ios-btn-secondary" id="student-notices-retry">Reintentar</button></div>`:'';
  if(!items.length)return `${error}<div class="empty-state sa-empty"><span class="sa-empty-icon">${icon('bell')}</span><h2>${loaded?'Sin avisos por ahora':'Consultando tus avisos'}</h2><p>Los comunicados que administración envíe a tu cuenta aparecerán aquí.</p></div>`;
  return error+`<div class="ios-card ios-card--flush list-group--icons">${items.map(n=>`<button type="button" class="list-row" data-student-notice="${Number(n.id)}">${rowIcon('bell',n.leida_en?'gray':'orange')}<span class="list-row__main"><span>${escape(n.titulo)}</span><span class="list-row__sub sa-notice-body">${escape(n.mensaje)}</span><span class="list-row__sub">${escape(n.creado_en)} · ${n.leida_en?'Leído':'Sin leer'}</span></span><span class="list-row__end">${ICON_CHEVRON}</span></button>`).join('')}</div><p class="sa-caption">Últimos 50 avisos de tu cuenta.</p>`;
}
export function bindStudentPushControls(view){
  view.querySelector('#student-notices-retry')?.addEventListener('click',()=>loadStudentNotices(true));
  view.querySelector('#student-push-toggle')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      if(!permission()){localStorage.setItem('ideas-push-choice:'+owner(),'on');if(sessionStorage.getItem('ideas-push-permission-asked'))bridge()?.openNotificationSettings?.();else{sessionStorage.setItem('ideas-push-permission-asked','1');bridge()?.requestNotificationPermission?.();let checks=0;clearTimeout(permissionTimer);const check=()=>{if(!studentSession())return;if(permission()){registerStudentPush();changed();return;}if(++checks<20&&!document.hidden)permissionTimer=setTimeout(check,1000);};permissionTimer=setTimeout(check,1000);}return;}
      const enabled=!preference();localStorage.setItem('ideas-push-choice:'+owner(),enabled?'on':'off');localStorage.removeItem(KEY);bindStudentNativeSession();
      await registerStudentPush();changed();
    }catch(e){showToast(e.message,'warning');}finally{button.disabled=false;}
  });
  view.querySelectorAll('[data-student-notice]').forEach(button=>button.addEventListener('click',async()=>{
    const id=Number(button.dataset.studentNotice),item=items.find(n=>Number(n.id)===id);if(!item||button.disabled)return;button.disabled=true;
    try{await studentRequest('avisos_leer',{notificacion_id:id});item.leida_en=item.leida_en||new Date().toISOString();location.hash=studentPushRoute(item.destino);changed();}
    catch(e){showToast(e.message,'warning');}finally{button.disabled=false;}
  }));
}
