// Ingreso con huella (app Android). Las credenciales se guardan cifradas en el almacén
// seguro del celular (BiometricVault.java) y solo se descifran poniendo la huella.
// En iPhone y en el navegador no está disponible (la opción no se muestra).
import { getServerKey, getStoredContext } from './server-context.js';

const bridge = () => (window.AndroidNet && typeof window.AndroidNet.biometricStatus === 'function' ? window.AndroidNet : null);
const OWNER_KEY = 'asistencia_biometric_owner';
const waiting = new Map();
let seq = 0;
export function biometricOwner() {
  try { return JSON.parse(localStorage.getItem(OWNER_KEY) || 'null'); } catch { return null; }
}
const clearOwner = () => { try { localStorage.removeItem(OWNER_KEY); } catch {} };
window.__bioDone = (id, json) => {
  const done = waiting.get(String(id));
  if (!done) return;
  let result;
  try { result = typeof json === 'string' ? JSON.parse(json) : json; } catch {}
  done(result && typeof result.status === 'string' ? result : { status: 'error' });
};

function call(method, ...args) {
  const b = bridge();
  if (!b || typeof b[method] !== 'function') return Promise.resolve({ status: 'unsupported' });
  if (waiting.size) return Promise.resolve({ status: 'busy' });
  return new Promise(resolve => {
    const id = `${Date.now()}-${++seq}`;
    const finish = result => { clearTimeout(timer); waiting.delete(id); resolve(result); };
    const timer = setTimeout(() => finish({ status: 'timeout' }), 90000);
    waiting.set(id, finish);
    try { b[method](id, ...args); } catch { finish({ status: 'error' }); }
  });
}

export function biometricStatus() {
  try { return bridge()?.biometricStatus() || 'unsupported'; } catch { return 'unsupported'; }
}
export function biometricAvailable() { return biometricStatus() === 'available'; }
export function biometricEnabled(accountType = 'trabajador') {
  try {
    if (!bridge()?.biometricEnabled()) return false;
    const owner = biometricOwner();
    if (owner) {
      if(owner.pending || owner.accountType !== accountType || owner.server !== getServerKey())return false;
      const user=JSON.parse(localStorage.getItem('asistencia_user')||'null');
      if(user){
        const student=user.tipo==='alumno';
        if(student!==(accountType==='alumno')||user.server_key!==owner.server)return false;
        const id=student?user.alumno_id:(user.id||user.trabajador_id);
        if(String(id||'')!==String(owner.accountId||'')||String(user.dni||'')!==String(owner.dni||''))return false;
      }
      return true;
    }
    // Una bóveda antigua sin identidad se vuelve a activar después de entrar con contraseña.
    return false;
  } catch { return false; }
}

function sessionIdentity(accountType, dni, serverKey) {
  try {
    const user = JSON.parse(localStorage.getItem('asistencia_user') || 'null');
    const token = localStorage.getItem('asistencia_token');
    const student = user?.tipo === 'alumno';
    if ((student && !token) || !user || user.server_key !== serverKey || String(user.dni || '') !== dni ||
        student !== (accountType === 'alumno')) return null;
    const id = student ? String(user.alumno_id || '') : getStoredContext().worker;
    if (!id || (student && user.id !== `alumno_${id}`)) return null;
    return { id, token };
  } catch { return null; }
}

export async function enrollBiometric(dni, password, { serverKey = getServerKey(), accountType = 'trabajador', bindingId = '' } = {}) {
  const before = sessionIdentity(accountType, dni, serverKey);
  if (!before || !serverKey || typeof dni !== 'string' || typeof password !== 'string' || !password ||
      !['alumno', 'trabajador'].includes(accountType)) return { error: 'session_changed' };
  if (waiting.size) return { error: 'busy' };
  const attempt = `${Date.now()}-${++seq}`;
  const owner = { accountType, server: serverKey, dni, accountId: before.id, bindingId, attempt, pending: true };
  try { localStorage.setItem(OWNER_KEY, JSON.stringify(owner)); } catch { return { error: 'storage' }; }
  const result = await call('biometricEnroll', JSON.stringify({ version: 2, account_type: accountType, account_id: before.id, binding_id: bindingId, server_key: serverKey, dni, password }));
  const after = sessionIdentity(accountType, dni, serverKey);
  const same = getServerKey() === serverKey && after?.id === before.id && after?.token === before.token;
  if (result.status !== 'ok' || !same) {
    if (biometricOwner()?.attempt === attempt) {
      clearOwner();
      // El nativo invalida el servidor de la bóveda al comenzar la activación.
      // Si llegó a guardar el secreto, se elimina cuando la sesión ya cambió.
      if (result.status === 'ok') { try { bridge()?.biometricDisable(); } catch {} }
    }
    return { error: same ? result.status : 'session_changed' };
  }
  try { localStorage.setItem(OWNER_KEY, JSON.stringify({ ...owner, pending: false })); }
  catch { try { bridge()?.biometricDisable(); } catch {} clearOwner(); return { error: 'storage' }; }
  return { ok: true };
}

export async function enableBiometric(dni, password, options = {}) {
  return Boolean((await enrollBiometric(dni, password, options)).ok);
}

export async function unlockWithBiometric({ accountType = 'trabajador', expectedDni = '', expectedAccountId = null } = {}) {
  const server = getServerKey();
  if (!server) return { error: 'server_mismatch' };
  const r = await call('biometricUnlock');
  if (r.status !== 'ok' || !r.secret) return { error: r.status || 'error' };
  try {
    const secret = JSON.parse(r.secret);
    const type = secret.account_type || 'trabajador';
    if (type !== accountType) return { error: 'account_mismatch' };
    if (!secret.server_key) return { error: 'reenroll_required' };
    if (secret.server_key !== server || getServerKey() !== server) return { error: 'server_mismatch' };
    if (!/^[0-9]{8}$/.test(secret.dni) || typeof secret.password !== 'string' || !secret.password) return { error: 'error' };
    if(expectedDni&&secret.dni!==String(expectedDni))return {error:'account_mismatch'};
    if(expectedAccountId!==null&&String(secret.account_id||'')!==String(expectedAccountId))return {error:'account_mismatch'};
    const owner=biometricOwner();
    if(owner&&(owner.pending||owner.accountType!==type||owner.server!==server||owner.dni!==secret.dni||String(owner.accountId)!==String(secret.account_id)||String(owner.bindingId||'')!==String(secret.binding_id||'')))return {error:'account_mismatch'};
    return { dni: secret.dni, password: secret.password, server_key: server, account_type: type,
      account_id: secret.account_id, binding_id: secret.binding_id };
  } catch { return { error: 'error' }; }
  finally { r.secret = ''; }
}

export function disableBiometric(accountType = 'trabajador') {
  const owner = biometricOwner();
  if (owner && owner.accountType !== accountType) return false;
  try { bridge()?.biometricDisable(); } catch {}
  clearOwner();
  return true;
}

// Sólo se llama después de que la API ha validado el nuevo acceso de trabajador.
export function forgetOtherWorkerBiometric(accountId,dni,serverKey=getServerKey()){
  const owner=biometricOwner();
  if(owner?.accountType!=='trabajador')return false;
  if(owner.server===serverKey&&String(owner.accountId)===String(accountId)&&String(owner.dni)===String(dni))return false;
  return disableBiometric('trabajador');
}

// Recordar que ya se ofreció activar la huella a este DNI (para no insistir)
const OFFER_KEY = 'asistencia_huella_ofrecida';
const offerKey = () => `${OFFER_KEY}:${getServerKey()}`;
export function wasOffered(dni) {
  try { return Boolean(getServerKey()) && (localStorage.getItem(offerKey()) || '').split(',').includes(String(dni)); } catch (_) { return false; }
}
export function markOffered(dni) {
  try {
    if (!getServerKey()) return;
    const key = offerKey();
    const list = (localStorage.getItem(key) || '').split(',').filter(Boolean);
    if (!list.includes(String(dni))) list.push(String(dni));
    localStorage.setItem(key, list.slice(-10).join(','));
  } catch (_) {}
}
