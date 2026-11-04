// Las contraseñas no se guardan en almacenamiento web; las operaciones sensibles exigen verificación.
import { getServerKey } from './server-context.js';
const USER='asistencia_user', TOKEN='asistencia_token';
const studentServerKey=getServerKey;
// Clave del servidor cuando la app no tiene ninguno elegido: si el puente nativo deja de informarlo (servidor perdido), la sesión se conserva.
const defaultServerKey=()=>{try{const url=new URL(String(window.APP_API_URL||'../api/'),location.href);return url.origin+url.pathname.replace(/\/+$/,'')+'/';}catch{return '';}};
const nativeServerUnavailable=()=>location.hostname==='appassets.androidplatform.net'&&typeof window.AndroidNet?.getServer==='function'&&studentServerKey()===defaultServerKey();
export function studentSession() {
  try { const user=JSON.parse(localStorage.getItem(USER)||'null'); if(user?.tipo==='alumno'){const key=studentServerKey();if(key&&user.server_key!==key&&!nativeServerUnavailable()){clearStudentSession();return null;}} return user?.tipo==='alumno' && localStorage.getItem(TOKEN) ? user : null; } catch { return null; }
}
const CACHE='ideas-student-cache',UI='ideas-student-ui',CACHE_MAX_MS=7*24*3600*1000;
// Última consulta correcta del alumno: permite abrir la app al instante con datos reales mientras se confirma en silencio si algo cambió.
export function saveStudentCache(data){
  const session=studentSession();if(!session||Number(data?.alumno?.id)!==Number(session.alumno_id))return;
  try{localStorage.setItem(CACHE,JSON.stringify({savedAt:Date.now(),server_key:session.server_key,alumno_id:session.alumno_id,data}));}catch{}
}
export function loadStudentCache(){
  try{
    const session=studentSession(),entry=JSON.parse(localStorage.getItem(CACHE)||'null');
    if(!session||!entry||entry.server_key!==session.server_key||Number(entry.alumno_id)!==Number(session.alumno_id))return null;
    if(!Number.isFinite(entry.savedAt)||Date.now()-entry.savedAt>CACHE_MAX_MS||Date.now()-entry.savedAt<0||Number(entry.data?.alumno?.id)!==Number(session.alumno_id))return null;
    return {data:entry.data,savedAt:entry.savedAt};
  }catch{return null;}
}
export function loadStudentUi(){try{const ui=JSON.parse(localStorage.getItem(UI)||'null'),session=studentSession();return ui&&session&&ui.server_key===session.server_key&&Number(ui.alumno_id)===Number(session.alumno_id)?ui:null;}catch{return null;}}
export function saveStudentUi(values){const session=studentSession();if(!session)return;try{localStorage.setItem(UI,JSON.stringify({...values,alumno_id:session.alumno_id,server_key:session.server_key}));}catch{}}
export function clearStudentSession() {
  try{window.AndroidNet?.clearSessionContext?.();localStorage.removeItem('ideas-student-push-registration');}catch{}
  window.dispatchEvent(new Event('student:session-ended'));
  localStorage.removeItem(USER); localStorage.removeItem(TOKEN); localStorage.removeItem('asistencia_company_config'); localStorage.removeItem(CACHE); localStorage.removeItem(UI);
  try{sessionStorage.removeItem('ideas-student-bootstrap');}catch{}
}
export function rememberStudentIdentity(profile){
  const user=studentSession();if(!user||Number(profile?.id)!==Number(user.alumno_id))return;
  if(profile.dni&&user.dni!==profile.dni)localStorage.setItem(USER,JSON.stringify({...user,dni:String(profile.dni)}));
}
export function consumeStudentBootstrap(){
  try{const raw=sessionStorage.getItem('ideas-student-bootstrap');sessionStorage.removeItem('ideas-student-bootstrap');const value=JSON.parse(raw||'null');const session=studentSession();return session&&Number.isFinite(value?.savedAt)&&Date.now()-value.savedAt>=0&&Date.now()-value.savedAt<60000&&value?.server_key===session.server_key&&Number(value.data?.alumno?.id)===session.alumno_id?value.data:null;}catch{return null;}
}
export async function studentRequest(accion, values={}) {
  if(accion!=='login'&&!studentSession())throw new Error('La sesión cambió o expiró. Vuelve a ingresar con tu cuenta de intranet.');
  if(nativeServerUnavailable())throw Object.assign(new Error('El servidor no está disponible. Puedes consultar tus datos guardados y volver a conectar desde Perfil.'),{offline:true});
  const base=studentServerKey().replace(/\/$/,'');
  if(!base)throw new Error('Configura una dirección de servidor válida.');
  // En el APK solo las rutas relativas del propio origen pasan por el puente nativo; una URL absoluta http queda bloqueada.
  const endpoint=new URL(`${String(window.APP_API_URL||'../api/').replace(/\/$/,'')}/alumnos.php`,location.href).href;
  const requestToken=localStorage.getItem(TOKEN)||'';
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await (window.ideasFetch||fetch)(endpoint,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},cache:'no-store',signal:controller.signal,body:JSON.stringify({accion,...values,...(accion==='login'?{}:{token_sesion:requestToken})})},accion==='perfil'||accion==='cambios');
    let result; try { result=await response.json(); } catch { throw new Error('El servidor no devolvió una respuesta válida.'); }
    if(!result||typeof result!=='object'||typeof result.success!=='boolean')throw new Error('El servidor no devolvió una respuesta válida.');
    if(base!==studentServerKey().replace(/\/$/,'')||(accion!=='login'&&requestToken!==(localStorage.getItem(TOKEN)||'')))throw new Error('El servidor o la sesión cambió durante la solicitud. Ingresa nuevamente.');
    if(!response.ok||!result.success) { if(response.status===401&&accion!=='login'){clearStudentSession();try{sessionStorage.setItem('ideas-login-type','alumno');sessionStorage.setItem('ideas-student-login-notice','Tu sesión expiró. Ingresa nuevamente con tu cuenta de intranet.');}catch{}location.reload();} const error=new Error(result.message||result.mensaje||'No se pudo consultar la intranet.');error.status=response.status;throw error; }
    return result.data;
  } catch(error){const offline=message=>Object.assign(new Error(message),{offline:true});if(error?.name==='AbortError')throw offline('La intranet tardó demasiado en responder. Revisa el servidor y tu conexión.');if(error instanceof TypeError)throw offline('No se pudo conectar con el servidor. Revisa la dirección configurada y tu red.');if(error?.status>=500)error.offline=true;throw error;} finally { clearTimeout(timer); }
}
export async function studentLogin(dni,password,{expectedAccountId=null}={}) {
  const loginServer=studentServerKey();
  const data=await studentRequest('login',{dni,password});
  if(loginServer!==studentServerKey())throw new Error('El servidor cambió durante el acceso. Vuelve a ingresar.');
  return acceptStudentLogin(data,dni,{expectedAccountId});
}
export function acceptStudentLogin(data,dni,{expectedAccountId=null}={}){
  if(!data?.token_sesion||!data?.alumno?.id)throw new Error('No se pudo iniciar la sesión del alumno.');
  if((data.alumno.dni&&String(data.alumno.dni)!==String(dni))||(expectedAccountId!==null&&String(data.alumno.id)!==String(expectedAccountId)))throw new Error('La cuenta devuelta no corresponde al alumno que está ingresando.');
  localStorage.removeItem('ideas-personal-session:v1');
  for(const key of ['asistencia_bloqueada','asistencia_credencial_local','asistencia_offline_vault','asistencia_offline_mode'])localStorage.removeItem(key);
  try { window.AndroidNet?.clearSessionContext?.(); } catch {}
  localStorage.setItem(USER,JSON.stringify({tipo:'alumno',id:`alumno_${data.alumno.id}`,alumno_id:data.alumno.id,dni:data.alumno.dni||dni,nombre:`${data.alumno.nombre} ${data.alumno.apellido}`,server_key:studentServerKey()}));
  localStorage.setItem(TOKEN,data.token_sesion); localStorage.removeItem('asistencia_company_config');
  try{sessionStorage.setItem('ideas-student-bootstrap',JSON.stringify({savedAt:Date.now(),server_key:studentServerKey(),data:{alumno:data.alumno,matriculas:data.matriculas||[],cursos:data.cursos||[],horarios:data.horarios||[],evaluaciones:data.evaluaciones||[],pagos:data.pagos||[],pagos_historial:data.pagos_historial||[],asistencia:data.asistencia||null,huella:data.huella||null}}));}catch{}
  return data;
}
