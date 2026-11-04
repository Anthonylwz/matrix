// Notificaciones push de la app Android (Firebase). En iPhone y en el navegador no hace nada.
import { apiRequest } from './api.js';
import { getToken, getUser, isAuthenticated, syncNativeSessionContext } from './auth.js';
import { getServerKey } from './server-context.js';

const REGISTERED_KEY = 'asistencia_fcm_registrado';
let registrationEpoch = 0;
let unregistering = false;
let inFlight = '';
let initialized = false;
let registrationPromise = null, registrationDirty = false;

const bridge = () => (window.AndroidNet && typeof window.AndroidNet.getFcmToken === 'function' ? window.AndroidNet : null);
const fcmToken = () => { try { return bridge()?.getFcmToken() || ''; } catch (_) { return ''; } };
const androidPermission = () => { try { return Boolean(bridge()?.notificationsAllowed?.()); } catch (_) { return false; } };

function appInfo() {
  try { return JSON.parse(bridge().getAppInfo() || '{}'); } catch (_) { return {}; }
}

// Pantalla de la web app para cada destino que envía el servidor (includes/fcm_queue.php)
export function routeFor(destination) {
  const d = String(destination || '');
  if (d === 'home' || d.startsWith('home?')) return '#home';
  if (d.startsWith('permissions')) return '#requests?tab=permisos';
  if (d.startsWith('corrections')) return '#requests?tab=correcciones';
  if (d.startsWith('history')) return '#history';
  return '#notifications';
}

// Registra el token en el servidor (una vez por token y sesión)
export function registerPush() {
  if(registrationPromise){registrationDirty=true;return registrationPromise;}
  registrationPromise=registerWorkerPush().finally(()=>{
    registrationPromise=null;
    if(registrationDirty){registrationDirty=false;return registerPush();}
  });
  return registrationPromise;
}
async function registerWorkerPush() {
  const b = bridge();
  if (!b || unregistering || !isAuthenticated() || !getToken()) return;
  syncNativeSessionContext();
  const epoch = registrationEpoch;
  const server = getServerKey();
  const session = getToken();
  const fcm = fcmToken();
  if (!fcm) return; // llegará con el evento android:fcmtoken
  const user = getUser();
  const permission = androidPermission();
  const stillCurrent = () => !unregistering && epoch === registrationEpoch && server === getServerKey()
    && String(user.id) === String(getUser()?.id || '') && session === getToken() && fcm === fcmToken()
    && permission === androidPermission();
  const digest = async (value) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
  };
  let marca;
  try { marca = `${server}|${user.id}|${await digest(session)}|${await digest(fcm)}|${permission}`; } catch (_) { return; }
  if (!stillCurrent() || inFlight === marca) return;
  try { const saved=JSON.parse(localStorage.getItem(REGISTERED_KEY)||'null');if(saved?.marca===marca&&Date.now()>=saved.time&&Date.now()-saved.time<86400000)return; } catch (_) {}
  inFlight = marca;

  const info = appInfo();
  try {
    const res = await apiRequest('registrar_fcm.php', {
      method: 'POST',
      body: {
        trabajador_id: user.id,
        token_sesion: session,
        accion: 'registrar',
        fcm_token: fcm,
        // El permiso del sistema y la elección del trabajador son independientes.
        // Sólo accion=preferencia modifica la elección guardada en el servidor.
        permiso_android: permission,
        app_version: info.version || '',
        android_sdk: info.sdk || 0
      }
    });
    if (res.success && !res.cancelled && stillCurrent()) {
      try { localStorage.setItem(REGISTERED_KEY, JSON.stringify({marca,time:Date.now()})); } catch (_) {}
    }
  } catch (_) {
    // La siguiente apertura o cambio de token reintenta; no se guarda un éxito fallido.
  } finally {
    if (inFlight === marca) inFlight = '';
  }
}

// Al cerrar sesión: el servidor deja de enviar avisos a este celular
export async function unregisterPush() {
  unregistering = true;
  registrationEpoch++;
  // El cierre local no depende de la red ni de que el endpoint pueda revocar el token FCM.
  try { bridge()?.clearSessionContext?.(); } catch (_) {}
  try { localStorage.removeItem(REGISTERED_KEY); } catch (_) {}
  if (!bridge() || !isAuthenticated() || !getToken()) return;
  const user = getUser();
  await apiRequest('registrar_fcm.php', {
    method: 'POST',
    body: { trabajador_id: user.id, token_sesion: getToken(), accion: 'eliminar', notificaciones_habilitadas: false },
    timeoutMs: 5000
  });
}

function openPendingDestination() {
  const b = bridge();
  if (!b || typeof b.takePendingDestination !== 'function' || !isAuthenticated() || unregistering) return;
  syncNativeSessionContext();
  const dest = b.takePendingDestination();
  const id = typeof b.takePendingNotificationId === 'function' ? Number(b.takePendingNotificationId()) : 0;
  if (!dest) return;
  // Igual que la app anterior: se registra que el aviso se abrió (y queda leído)
  if (id > 0 && getToken()) {
    const user = getUser();
    apiRequest('confirmar_notificacion.php', {
      method: 'POST',
      body: { trabajador_id: user.id, token_sesion: getToken(), notificacion_id: id, evento: 'abierta' }
    }).then((response) => { if (!response.cancelled && response.success) window.dispatchEvent(new Event('android:push')); }).catch(() => {});
  }
  window.location.hash = routeFor(dest);
}

export function initPush() {
  if (!bridge() || initialized) return;
  initialized = true;
  syncNativeSessionContext();
  window.addEventListener('android:fcmtoken', () => registerPush());
  window.addEventListener('android:notification', openPendingDestination);
  // Tras iniciar sesión o al volver a la app
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#home')) { openPendingDestination(); registerPush(); }
  });
  window.addEventListener('auth:changed', () => {
    registrationEpoch++;
    unregistering = false;
    syncNativeSessionContext();
    registerPush();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { syncNativeSessionContext(); openPendingDestination(); registerPush(); }
  });
  openPendingDestination();
  registerPush();
}
