// La bóveda nativa cifra la contraseña; JS solo conserva la vinculación sin secretos.
import { biometricStatus, biometricEnabled, biometricOwner, enrollBiometric, unlockWithBiometric, disableBiometric } from './biometric.js';
import { studentSession, studentRequest, studentLogin } from './student-api.js';
import { getServerKey } from './server-context.js';
const KEY='ideas-student-biometric';
let pending=false;
export { biometricStatus };
function binding(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}}
function newBindingId(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  if(typeof crypto.getRandomValues!=='function')throw new Error('Actualiza Android System WebView para activar la huella.');
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function studentBiometricIdentity(){
  const b=binding(),owner=biometricOwner();
  if(!biometricEnabled('alumno')||b?.version!==2||!b.bindingId||owner?.bindingId!==b.bindingId||
      owner?.accountId!==String(b.accountId)||owner?.dni!==b.dni||b.server!==getServerKey())return null;
  return {dni:b.dni,accountId:b.accountId};
}
export function studentBiometricEnabled(){
  const identity=studentBiometricIdentity(),session=studentSession();
  return Boolean(identity&&(!session||(String(identity.accountId)===String(session.alumno_id)&&identity.dni===String(session.dni))));
}
export function forgetStudentBiometric(){
  if(binding())disableBiometric('alumno');
  try{localStorage.removeItem(KEY);}catch{}
}
const messages={cancelled:'Lectura cancelada. Puedes ingresar con tu contraseña.',lockout:'Demasiados intentos de huella. Ingresa con contraseña.',
  invalidated:'Las huellas del teléfono cambiaron. Actívala de nuevo desde Perfil.',server_mismatch:'El servidor cambió. Ingresa con contraseña.',
  server_changed:'El servidor cambió durante la lectura. Ingresa con contraseña.',account_mismatch:'La huella pertenece a otra cuenta. Actívala para tu cuenta de alumno desde Perfil.',
  session_changed:'La sesión cambió. Ingresa nuevamente.',timeout:'La lectura tardó demasiado. Inténtalo de nuevo o ingresa con contraseña.',
  busy:'Ya hay una lectura de huella en curso.',storage:'No se pudo guardar la configuración en este teléfono.',
  reenroll_required:'Vuelve a activar la huella para alumnos desde Perfil.',not_enrolled:'Activa el ingreso con huella desde Perfil.'};
export async function enrollStudentBiometric(password){
  if(pending)throw new Error(messages.busy);
  const user=studentSession(),token=localStorage.getItem('asistencia_token');
  if(!user?.dni)throw new Error('Ingresa de nuevo para vincular la huella a tu DNI.');
  if(biometricStatus()!=='available')throw new Error('Activa una huella en los ajustes de seguridad del teléfono.');
  pending=true;
  try{
    await studentRequest('verificar_password',{password_actual:password});
    if(studentSession()?.id!==user.id||localStorage.getItem('asistencia_token')!==token||getServerKey()!==user.server_key)throw new Error(messages.session_changed);
    const bindingId=newBindingId();
    const result=await enrollBiometric(String(user.dni),password,{serverKey:user.server_key,accountType:'alumno',bindingId});
    if(result.error)throw new Error(messages[result.error]||'No se activó la huella. Puedes intentarlo de nuevo.');
    try{localStorage.setItem(KEY,JSON.stringify({version:2,server:user.server_key,dni:String(user.dni),accountId:String(user.alumno_id),bindingId}));}
    catch{disableBiometric('alumno');throw new Error(messages.storage);}
  }finally{pending=false;}
}
export async function loginStudentBiometric({dni=''}={}){
  if(pending)throw new Error(messages.busy);
  const expected=binding(),server=getServerKey();
  if(!expected||!studentBiometricEnabled())throw new Error('Ingresa con contraseña y activa la huella desde Perfil.');
  if(dni&&String(dni)!==expected.dni)throw new Error('La huella está vinculada a otro DNI. Ingresa con la contraseña de esa cuenta.');
  pending=true;
  let unlocked;
  try{
    unlocked=await unlockWithBiometric({accountType:'alumno'});
    if(unlocked.error){
      if(['invalidated','reenroll_required','not_enrolled','account_mismatch'].includes(unlocked.error))forgetStudentBiometric();
      throw new Error(messages[unlocked.error]||'No se pudo leer la huella. Ingresa con contraseña.');
    }
    const current=binding();
    if(getServerKey()!==server||unlocked.server_key!==server||current?.bindingId!==expected.bindingId||
       unlocked.binding_id!==expected.bindingId||String(unlocked.account_id)!==String(expected.accountId)||String(unlocked.dni)!==expected.dni)
      throw new Error('La huella guardada corresponde a otra cuenta o servidor. Ingresa con contraseña.');
    try{return await studentLogin(unlocked.dni,unlocked.password,{expectedAccountId:expected.accountId});}
    catch(error){if([401,403].includes(error.status))forgetStudentBiometric();throw error;}
  }finally{if(unlocked)unlocked.password='';pending=false;}
}
