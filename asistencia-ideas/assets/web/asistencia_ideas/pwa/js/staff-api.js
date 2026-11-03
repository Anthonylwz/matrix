import { getServerKey } from './server-context.js';
import { getDeviceId, clearSession } from './auth.js';
import { clearStudentSession } from './student-api.js';
const KEY='ideas-personal-session:v1';
export function staffSession(){
  try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.server===getServerKey()&&s.expires>Date.now()&&/^[a-f0-9]{64}$/.test(s.token)&&['asistencia','intranet'].includes(s.identity?.origen))return s;localStorage.removeItem(KEY);}catch{}return null;
}
export function forgetStaffSession(){localStorage.removeItem(KEY);try{window.AndroidNet?.clearSessionContext?.();}catch{}}
export async function storeStaffSession(data){
  if(data?.tipo!=='personal'||!Number.isSafeInteger(data.identidad?.id)||data.identidad.id<1||!['asistencia','intranet'].includes(data.identidad?.origen)||typeof data.token_sesion!=='string'||!(/^[a-f0-9]{64}$/.test(data.token_sesion)))throw new Error('El servidor no identificó tu cuenta.');
  const server=getServerKey();
  await clearSession();
  if(server!==getServerKey())throw new Error('El servidor cambió durante el acceso. Vuelve a ingresar.');
  clearStudentSession();
  localStorage.setItem(KEY,JSON.stringify({identity:data.identidad,token:data.token_sesion,server,expires:Date.now()+Math.min(28800,Number(data.expira_en_segundos)||28800)*1000}));
}
async function request(endpoint,body,{authenticated=false,signal}={}){
  const session=staffSession(),server=getServerKey(),token=session?.token||'';
  if(authenticated&&!session)throw Object.assign(new Error('Vuelve a ingresar con tu cuenta.'),{status:401});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)controller.abort();
  try{
    const url=new URL(String(window.APP_API_URL||'../api/').replace(/\/$/,'')+'/'+endpoint,location.href).href;
    const response=await fetch(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},cache:'no-store',signal:controller.signal,body:JSON.stringify({...body,...(authenticated?{token_sesion:token}:{}),device_token:getDeviceId()})});
    const result=await response.json();
    if(server!==getServerKey()||(authenticated&&staffSession()?.token!==token))throw new Error('La cuenta o el servidor cambiaron durante la consulta.');
    if(!response.ok||result.success!==true){if(response.status===401&&authenticated)forgetStaffSession();throw Object.assign(new Error(result.message||'No se pudo completar la solicitud.'),{status:response.status});}
    return result.data;
  }catch(e){if(e.name==='AbortError')throw new Error('La conexión tardó demasiado. Reintenta cuando tengas señal.');if(e instanceof TypeError)throw new Error('No se pudo conectar con el servidor.');throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export const unifiedLogin=(usuario,password,origen='automatico')=>request('acceso_app.php',{usuario,dni:usuario,password,origen});
export const staffRequest=(accion,values={},options={})=>request('personal_app.php',{...values,accion},{...options,authenticated:true});
export async function staffLogout(){
  const server=getServerKey(),session=staffSession();
  try{await staffRequest('salir');}finally{
    // Una respuesta tardía del cierre A no borra la nueva cuenta B ni su contexto nativo.
    if(server===getServerKey()){const current=staffSession();if((!current||current.token===session?.token)&&!localStorage.getItem('asistencia_user')){forgetStaffSession();location.hash='#login';location.reload();}}
  }
}
