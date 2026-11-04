import { QRScannerController } from './scanner.js';
import { staffRequest, staffSession } from './staff-api.js';
import { getServerKey } from './server-context.js';
import { openSheet, closeSheet, dismissSheet, showToast, ICON_CHEVRON } from './utils.js';
import { icon, rowIcon } from './icons.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active=null,sequence=0,bound=false;
export function parsePersonalLoginQR(raw,origin){
  if(typeof raw!=='string'||raw.length>400)throw new Error('Escanea el QR de ingreso que muestra tu panel web.');
  let qr;try{qr=JSON.parse(raw);}catch{throw new Error('Este QR no corresponde a tu panel web.');}
  if(!qr||Array.isArray(qr)||Object.keys(qr).some(key=>!['type','v','request','secret'].includes(key))||qr.type!==(origin==='asistencia'?'ideas-asistencia-login':'ideas-intranet-login')||qr.v!==1||typeof qr.request!=='string'||typeof qr.secret!=='string'||! /^[a-f0-9]{32}$/.test(qr.request)||! /^[a-f0-9]{64}$/.test(qr.secret))throw new Error('Este QR no corresponde a tu panel web.');
  return {request:qr.request,secret:qr.secret};
}
export const personalQrOpen=()=>Boolean(active);
export const personalQrBusy=()=>Boolean(active?.busy);
export function handlePersonalQrBack(){if(!active)return false;if(!active.busy)dismissSheet(active.modal);return true;}
function stopCamera(){active?.scanner?.stop();}
function clearActive(){stopCamera();if(active)clearInterval(active.timer);active=null;sequence++;}
export function personalWebLoginMarkup(origin){return `<div class="list-header">Acceso web</div><div class="ios-card ios-card--flush list-group--icons"><button type="button" id="personal-open-web-login" class="list-row" aria-haspopup="dialog">${rowIcon('qr','blue')}<span class="list-row__main"><span>Entrar a mi panel web</span><span class="list-row__sub">Escanea y confirma desde este teléfono</span></span><span class="list-row__end">${ICON_CHEVRON}</span></button></div>
  <div id="personal-web-login-sheet" class="sheet-backdrop" hidden><div class="sheet sa-web-login" aria-labelledby="personal-web-login-title"><div class="sheet__grabber"></div><div class="sheet__nav"><button type="button" id="personal-web-login-close" class="nav-btn nav-btn--text">Cerrar</button><h3 id="personal-web-login-title" class="sheet__nav-title">Entrar a mi panel web</h3><span></span></div>
  <div id="personal-web-login-scan"><p class="sheet-hint">En la página de ingreso de tu panel web, elige <strong>Con QR</strong> y apunta al código.</p><div class="sa-web-login__camera"><video id="personal-web-login-video" playsinline autoplay muted></video><div class="sa-web-login__guide" aria-hidden="true"></div></div><button type="button" id="personal-web-login-retry" class="ios-btn ios-btn-secondary" hidden>Volver a abrir la cámara</button></div>
  <div id="personal-web-login-confirm" hidden><div class="sa-web-login__emblem">${icon('smartphone')}</div><h2>¿Confirmas este acceso?</h2><p class="sheet-hint">Ingresarás con tu cuenta y tus permisos actuales en ese navegador.</p><div class="sa-web-login__details" id="personal-web-login-details"></div><p class="sheet-hint">Comprueba que el código coincide con el de tu pantalla. Confirma solo si tú abriste ese navegador.</p><div class="sa-web-login__actions"><button type="button" id="personal-web-login-deny" class="ios-btn ios-btn-secondary">Rechazar</button><button type="button" id="personal-web-login-approve" class="ios-btn ios-btn-primary">Confirmar acceso</button></div></div>
  <p id="personal-web-login-status" class="sheet-hint sa-web-login__status" role="status" aria-live="polite"></p></div></div>`;}
export function bindPersonalWebLogin(root,{onIdle}={}){
  const open=root.querySelector('#personal-open-web-login'),modal=root.querySelector('#personal-web-login-sheet');if(!open||!modal)return;
  // La librería mueve la hoja a <body> al abrirla: sus controles se buscan en la hoja.
  const select=id=>modal.querySelector('#personal-web-login-'+id);
  const status=select('status'),video=select('video'),scan=select('scan'),confirm=select('confirm'),approve=select('approve'),deny=select('deny'),retry=select('retry'),close=select('close');
  const paintStatus=(text,error=false)=>{status.textContent=text;status.setAttribute('role',error?'alert':'status');};
  const sameIdentity=state=>state.server===getServerKey()&&state.token===staffSession()?.token&&String(state.owner)===String(staffSession()?.identity.id)&&state.origin===staffSession()?.identity.origen;
  const current=state=>active===state&&state.tag===sequence&&sameIdentity(state);
  function abandonStale(state){if(active===state&&!current(state)){clearActive();closeSheet(state.modal);return true;}return false;}
  function expired(state){return !state.pending||Date.now()>=state.deadline;}
  function paintExpiry(state){if(!current(state)){abandonStale(state);return;}if(expired(state)){approve.disabled=true;paintStatus('El código venció. Cierra esta ventana y genera otro QR en tu panel web.',true);}else if(!state.busy&&!state.error)paintStatus('El acceso vence en '+Math.max(0,Math.ceil((state.deadline-Date.now())/1000))+' s.');}
  async function start(state){
    if(!current(state)){abandonStale(state);return;}if(state.busy||state.pending||document.hidden)return;
    retry.hidden=true;paintStatus('Abriendo cámara…');
    const result=await state.scanner.start();if(!current(state)){state.scanner.stop();abandonStale(state);return;}
    if(!result.success&&!result.cancelled){paintStatus(result.message||'No se pudo abrir la cámara. Revisa sus permisos.',true);retry.hidden=false;}
    else if(result.success)paintStatus('Apunta al QR de ingreso de la intranet.');
  }
  async function scanned(state,raw){
    if(!current(state)){abandonStale(state);return;}if(state.busy||state.pending)return;
    let qr;try{qr=parsePersonalLoginQR(raw,state.origin);}catch(error){paintStatus(error.message,true);return;}
    state.busy=true;state.scanner.stop();close.disabled=true;paintStatus('Comprobando el acceso…');
    try{
      const result=await staffRequest('qr_login_preparar',qr);if(!current(state))return;
      if(result.request!==qr.request||! /^[a-f0-9]{64}$/.test(result.confirmacion)||!Number.isFinite(Number(result.expira_en))||!Number.isFinite(Number(result.servidor_ahora)))throw new Error('La intranet devolvió una confirmación inválida.');
      state.pending={request:result.request,confirmacion:result.confirmacion};state.deadline=Date.now()+Math.max(0,Number(result.expira_en)-Number(result.servidor_ahora))*1000;
      select('details').innerHTML=`<strong>${esc(staffSession()?.identity.nombre||'Mi cuenta institucional')}</strong><span>${esc(result.sitio)}</span><span>${esc(result.host)}</span><span>${esc(result.navegador)}</span><span class="sa-web-login__code">${esc(result.codigo)}</span>`;
      scan.hidden=true;confirm.hidden=false;approve.disabled=false;deny.disabled=false;state.timer=setInterval(()=>paintExpiry(state),1000);
    }catch(error){if(current(state)){state.pending=null;paintStatus(error.message,true);retry.hidden=false;}}
    finally{if(current(state)){state.busy=false;close.disabled=false;if(state.pending)paintExpiry(state);}else abandonStale(state);}
  }
  async function decide(accepted){
    const state=active;if(!state)return;if(!current(state)){abandonStale(state);return;}if(state.busy||!state.pending)return;
    if(accepted&&expired(state)){paintExpiry(state);return;}
    state.busy=true;state.error=false;approve.disabled=deny.disabled=close.disabled=true;paintStatus(accepted?'Confirmando acceso…':'Rechazando acceso…');
    try{
      const result=await staffRequest(accepted?'qr_login_confirmar':'qr_login_rechazar',state.pending);if(!current(state)){abandonStale(state);return;}
      if(result.estado!==(accepted?'aprobado':'rechazado'))throw new Error('No se pudo confirmar la operación.');
      state.decided=true;state.busy=false;await closeSheet(modal);if(sameIdentity(state))showToast(accepted?'Acceso autorizado. Continúa en tu navegador.':'Acceso rechazado.',accepted?'success':'info');
    }catch(error){if(current(state)){state.error=true;paintStatus(error.message,true);state.busy=false;deny.disabled=false;approve.disabled=expired(state);close.disabled=false;}else abandonStale(state);}
  }
  open.addEventListener('click',()=>{
    if(active||!staffSession())return;
    if(navigator.onLine===false){showToast('Necesitas conexión para iniciar sesión en tu panel web.','info');return;}
    scan.hidden=false;confirm.hidden=true;select('details').replaceChildren();close.disabled=false;
    const state={tag:++sequence,modal,owner:staffSession().identity.id,origin:staffSession().identity.origen,server:getServerKey(),token:staffSession().token,busy:false,pending:null,timer:null};active=state;
    state.resume=()=>start(state);state.expiry=()=>paintExpiry(state);
    state.scanner=new QRScannerController(video,raw=>scanned(state,raw),error=>{if(current(state)){paintStatus(state.scanner.getFriendlyErrorMessage(error),true);retry.hidden=false;}});
    openSheet(modal,{canDismiss:()=>!state.busy,onClose:()=>{if(current(state)&&state.pending&&!state.decided)staffRequest('qr_login_rechazar',state.pending).catch(()=>{});if(active===state)clearActive();if(sameIdentity(state))onIdle?.();}});start(state);
  });
  close.addEventListener('click',()=>{if(!active?.busy)dismissSheet(modal);});retry.addEventListener('click',()=>{if(active)start(active);});
  approve.addEventListener('click',()=>decide(true));deny.addEventListener('click',()=>decide(false));
  if(!bound){bound=true;window.addEventListener('storage',()=>{if(active&&!sameIdentity(active)){const old=active;clearActive();closeSheet(old.modal);}});window.addEventListener('hashchange',()=>{if(active){const old=active;clearActive();closeSheet(old.modal);}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();else if(active){if(active.pending)active.expiry();else active.resume();}});}
}
