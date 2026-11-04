// Módulo de autenticación y persistencia de sesión segura
import { initDB } from './db.js';
import { getServerKey, getNativeServerBase } from './server-context.js';

const STORAGE_KEY_USER = 'asistencia_user';
const STORAGE_KEY_TOKEN = 'asistencia_token';
const STORAGE_KEY_DEVICE = 'asistencia_device_id';
const STORAGE_KEY_CONFIG = 'asistencia_company_config';
// Modelo "pantalla de bloqueo": el celular queda vinculado al trabajador (usuario, token y
// configuración se conservan). "Cerrar sesión" solo bloquea; para desbloquear se valida la
// contraseña con el servidor o, sin Internet, contra un verificador PBKDF2 local (nunca la
// contraseña). La cuenta se borra del todo solo al desvincular el celular o entrar con otro DNI.
const STORAGE_KEY_LOCKED = 'asistencia_bloqueada';
const STORAGE_KEY_CREDENTIAL = 'asistencia_credencial_local';
// Formatos anteriores (se migran al cargar)
const LEGACY_KEY_VAULT = 'asistencia_offline_vault';
const LEGACY_KEY_OFFLINE_MODE = 'asistencia_offline_mode';
const PBKDF2_ITERATIONS = 150000;
const OFFLINE_DAYS_DEFAULT = 30;
const MAX_LOCAL_FAILS = 5;
const LOCAL_WAIT_MS = 5 * 60 * 1000;

// El contenedor sólo conserva la identidad y el hash del token; no recibe la contraseña.
export function syncNativeSessionContext() {
  const bridge = window.AndroidNet;
  if (!bridge) return;
  try {
    const user = getUser();
    const token = getToken();
    if (user && token && !isLocked()) {
      bridge.setSessionContext?.(getNativeServerBase(), String(user.id), token);
    } else bridge.clearSessionContext?.();
  } catch (_) {
    try { bridge.clearSessionContext?.(); } catch (_) {}
  }
}

function notifySessionChanged() {
  syncNativeSessionContext();
  window.dispatchEvent(new Event('auth:changed'));
}

// Valida si el DNI cumple con el estándar peruano (8 dígitos numéricos)
export function validateDni(dni) {
  if (!dni) return false;
  return /^[0-9]{8}$/.test(String(dni).trim());
}

// Comprueba si existe sesión activa (cuenta vinculada y app desbloqueada)
export function isAuthenticated() {
  const user = getUser();
  if (!user || !(user.id || user.trabajador_id) || isLocked()) return false;
  return Boolean(getToken() || getOfflineToken(user.id) || readCredential());
}

// Hay un trabajador vinculado a este celular (aunque la app esté bloqueada)
export function hasAccount() {
  return Boolean(getUser());
}

// La app está bloqueada: hay que volver a escribir la contraseña (o usar la huella)
export function isLocked() {
  return localStorage.getItem(STORAGE_KEY_LOCKED) === '1';
}

// Desbloqueada pero sin token del servidor (p. ej. el servidor lo invalidó): solo puede marcar
export function isOfflineSession() {
  return Boolean(getUser()) && !getToken();
}

// Obtiene los datos del trabajador autenticado
export function getUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USER);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (user?.tipo && user.tipo !== 'trabajador') return null;
    // Un token de otra sede, o sin procedencia comprobable, exige volver a entrar.
    if (!user || user.server_key !== getServerKey()) return null;
    // Asegurar compatibilidad de id y trabajador_id
    if (user && !user.id && user.trabajador_id) {
      user.id = user.trabajador_id;
    }
    return user;
  } catch (_) {
    return null;
  }
}

// Obtiene el token de sesión
export function getToken() {
  return getUser() ? localStorage.getItem(STORAGE_KEY_TOKEN) || '' : '';
}

// Obtiene la configuración de sede y horario del trabajador
export function getCompanyConfig() {
  try {
    if (!getUser()) return null;
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

// Identificador único y persistente del dispositivo iPhone
export function getDeviceId() {
  let deviceId = localStorage.getItem(STORAGE_KEY_DEVICE);
  if (!deviceId) {
    deviceId = 'ios_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36));
    localStorage.setItem(STORAGE_KEY_DEVICE, deviceId);
  }
  return deviceId;
}

// Nombre, modelo y sistema del equipo para el registro de dispositivos del panel
// (antes todo se registraba como "iPhone", incluida la app Android)
export function describeDevice() {
  const ua = navigator.userAgent || '';
  if (/AsistenciaAndroid/i.test(ua)) return { deviceName: 'Android (app)', deviceModel: 'Android', deviceOs: 'Android' };
  if (/Android/i.test(ua)) return { deviceName: 'Android (navegador)', deviceModel: 'Android', deviceOs: 'Android' };
  if (/iPhone|iPad|iPod/i.test(ua)) return { deviceName: 'iPhone (Safari PWA)', deviceModel: 'iPhone', deviceOs: 'iOS' };
  return { deviceName: 'Navegador web', deviceModel: 'Web', deviceOs: 'Web' };
}

// ── Credencial local (desbloqueo sin conexión) ──
// Una sola: la del trabajador vinculado a este celular y a este servidor.
function readCredential() {
  try {
    const cred = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDENTIAL) || 'null');
    const user = getUser();
    if (!cred || !user || cred.server_key !== getServerKey() || String(cred.worker_id) !== String(user.id)) return null;
    return cred;
  } catch (_) {
    return null;
  }
}

function writeCredential(cred) {
  try {
    if (cred) localStorage.setItem(STORAGE_KEY_CREDENTIAL, JSON.stringify(cred));
    else localStorage.removeItem(STORAGE_KEY_CREDENTIAL);
  } catch (_) {}
}

// Convierte el formato anterior (vault por DNI + modo offline) en la credencial única
function migrateLegacyStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY_VAULT);
    if (raw && !localStorage.getItem(STORAGE_KEY_CREDENTIAL)) {
      const user = getUser();
      const vault = JSON.parse(raw) || {};
      const entry = user && Object.values(vault).find((e) => e && e.user && String(e.user.id) === String(user.id) && e.server_key === getServerKey());
      if (entry && entry.verifier && entry.salt) {
        writeCredential({
          server_key: entry.server_key,
          worker_id: String(user.id),
          dni: String(entry.user.dni || user.dni || ''),
          salt: entry.salt,
          verifier: entry.verifier,
          token_offline: entry.token_offline || '',
          online_at: Date.now(),
          dias: OFFLINE_DAYS_DEFAULT,
          fails: 0,
          wait_until: 0,
          needs_online: false
        });
      }
    }
    localStorage.removeItem(LEGACY_KEY_VAULT);
    localStorage.removeItem(LEGACY_KEY_OFFLINE_MODE);
  } catch (_) {}
}

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function passwordVerifier(dni, password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const salt = new TextEncoder().encode(`${saltHex}:${dni}`);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}

// Guarda el verificador de la contraseña tras un login con el servidor (o al cambiarla).
// No depende de token_offline: si el servidor no lo emite, se sincroniza con el token de sesión.
export async function rememberPassword(workerData, password) {
  if (!workerData || !password || !crypto.subtle) return false;
  const user = getUser();
  if (!user || String(user.id) !== String(workerData.trabajador_id || workerData.id || user.id)) return false;
  const dni = String(workerData.dni || user.dni || '').trim();
  if (!validateDni(dni)) return false;
  const server = getServerKey();
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = await passwordVerifier(dni, password, salt);
  if (getServerKey() !== server || String(getUser()?.id) !== String(user.id)) return false;
  const previous = readCredential();
  writeCredential({
    server_key: server,
    worker_id: String(user.id),
    dni,
    salt,
    verifier,
    // Al cambiar la contraseña no llega token_offline nuevo: se conserva el anterior
    token_offline: workerData.token_offline || (previous && previous.token_offline) || '',
    online_at: Date.now(),
    dias: Number(workerData.offline_dias) || (previous && previous.dias) || OFFLINE_DAYS_DEFAULT,
    fails: 0,
    wait_until: 0,
    needs_online: false
  });
  return true;
}
export const saveOfflineAccess = rememberPassword;

// DNI del trabajador vinculado (para precargar el login)
export function accountDni() {
  const user = getUser();
  return user ? String(user.dni || '') : '';
}

// Desbloquea sin servidor si la contraseña coincide con la del último ingreso en línea.
// Motivos de rechazo: unknown, other_account, needs_online, expired, throttled, password, session_changed
export async function unlockOffline(dni, password) {
  dni = String(dni || '').trim();
  const user = getUser();
  if (!user) return { ok: false, reason: 'unknown' };
  if (String(user.dni || '') !== dni) return { ok: false, reason: 'other_account' };
  const cred = readCredential();
  if (!cred || !crypto.subtle) return { ok: false, reason: 'unknown' };
  const server = getServerKey();
  const token = getToken();
  const credentialSnapshot = localStorage.getItem(STORAGE_KEY_CREDENTIAL);
  const lockSnapshot = localStorage.getItem(STORAGE_KEY_LOCKED);
  const unchangedAccount = () => {
    const current = getUser();
    return server === getServerKey() && String(current?.id || '') === String(user.id)
      && String(current?.dni || '') === String(user.dni || '') && token === getToken()
      && credentialSnapshot === localStorage.getItem(STORAGE_KEY_CREDENTIAL)
      && lockSnapshot === localStorage.getItem(STORAGE_KEY_LOCKED);
  };
  if (cred.needs_online) return { ok: false, reason: 'needs_online' };
  if (cred.online_at + (cred.dias || OFFLINE_DAYS_DEFAULT) * 86400000 <= Date.now()) return { ok: false, reason: 'expired' };
  if (cred.wait_until && cred.wait_until > Date.now()) {
    return { ok: false, reason: 'throttled', waitSeconds: Math.ceil((cred.wait_until - Date.now()) / 1000) };
  }
  const verifier = await passwordVerifier(dni, password, cred.salt);
  // PBKDF2 es asíncrono. Otra pestaña o un cambio de cuenta puede haber
  // reemplazado la credencial o el bloqueo mientras calculábamos la anterior.
  // Ni un acierto ni un fallo deben modificar el estado de esa nueva sesión.
  if (!unchangedAccount()) return { ok: false, reason: 'session_changed' };
  if (verifier !== cred.verifier) {
    cred.fails = (cred.fails || 0) + 1;
    if (cred.fails >= MAX_LOCAL_FAILS) {
      cred.fails = 0;
      cred.wait_until = Date.now() + LOCAL_WAIT_MS;
    }
    writeCredential(cred);
    return { ok: false, reason: 'password' };
  }
  cred.fails = 0;
  cred.wait_until = 0;
  writeCredential(cred);
  localStorage.removeItem(STORAGE_KEY_LOCKED);
  notifySessionChanged();
  return { ok: true, user };
}

// Credencial sin conexión emitida por el servidor (respaldo para sincronizar)
export function getOfflineToken(workerId) {
  const cred = readCredential();
  return cred && String(cred.worker_id) === String(workerId) ? cred.token_offline || '' : '';
}

// "Cerrar sesión": bloquea la app sin borrar la cuenta (se puede volver a entrar sin Internet)
export function lockSession() {
  localStorage.setItem(STORAGE_KEY_LOCKED, '1');
  notifySessionChanged();
}

// El servidor rechazó la sesión (401/403): se bloquea y solo se podrá entrar con Internet
export function markNeedsOnline() {
  const cred = readCredential();
  if (cred) {
    cred.needs_online = true;
    writeCredential(cred);
  }
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  lockSession();
}

// Guarda la sesión tras un login exitoso (nunca guarda contraseñas)
export async function saveSession(workerData, tokenSesion) {
  if (!workerData || !tokenSesion) return false;

  localStorage.removeItem('ideas-personal-session:v1');
  const userData = {
    tipo: 'trabajador',
    rol: 'trabajador',
    server_key: getServerKey(),
    id: workerData.trabajador_id || workerData.id,
    trabajador_id: workerData.trabajador_id || workerData.id,
    dni: workerData.dni,
    nombre: workerData.nombre,
    nombres: workerData.nombres,
    apellidos: workerData.apellidos,
    codigo_interno: workerData.codigo_interno,
    telefono: workerData.telefono,
    foto_url: workerData.foto_url,
    server_time: workerData.server_time
  };

  const configData = {
    sede_config: workerData.sede_config || null,
    horario_config: workerData.horario_config || null
  };

  // Persistencia primaria en LocalStorage
  localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userData));
  localStorage.setItem(STORAGE_KEY_TOKEN, tokenSesion);
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(configData));
  localStorage.removeItem(STORAGE_KEY_LOCKED);
  notifySessionChanged();

  // Respaldo en IndexedDB users_cache para operación offline
  try {
    const db = await initDB();
    const tx = db.transaction('users_cache', 'readwrite');
    const store = tx.objectStore('users_cache');
    store.put(userData);
  } catch (err) {
    console.warn('No se pudo guardar usuario en IndexedDB:', err);
  }

  return true;
}

// Borra la cuenta vinculada del celular (desvincular o entrar con otro DNI), sin borrar
// las marcaciones pendientes. Para el "Cerrar sesión" normal se usa lockSession().
export async function clearSession() {
  // El cierre local protege también cuando no se puede avisar al servidor.
  try { window.AndroidNet?.clearSessionContext?.(); } catch (_) {}
  localStorage.removeItem(STORAGE_KEY_LOCKED);
  localStorage.removeItem(STORAGE_KEY_CREDENTIAL);
  localStorage.removeItem(STORAGE_KEY_USER);
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_CONFIG);
  notifySessionChanged();

  // Limpiar los datos del trabajador en IndexedDB conservando la cola pending_operations
  // (el historial guardado también: si no, el siguiente trabajador que entre en este
  // celular vería sin conexión el historial del anterior)
  try {
    const db = await initDB();
    const tx = db.transaction(['users_cache', 'attendance_cache'], 'readwrite');
    tx.objectStore('users_cache').clear();
    tx.objectStore('attendance_cache').clear();
  } catch (_) {}
}

export const forgetAccount = clearSession;

// Al arrancar se descarta cualquier contexto nativo sin una sesión web vigente y vinculada.
migrateLegacyStorage();
syncNativeSessionContext();
