// Módulo de sincronización de operaciones offline con el servidor PHP
import { apiRequest, checkServerStatus, horaLima } from './api.js';
import {
  getPendingOperations,
  updatePendingOperation,
  deletePendingOperation,
  logSyncEvent,
  getPendingOperationsCount
} from './db.js';
import { getToken, getUser, getDeviceId, getOfflineToken, markNeedsOnline } from './auth.js';
import { showToast, setConnectionStatus } from './utils.js';
import { getStoredContext, belongsToContext } from './server-context.js';

let isSyncing = false;
// Una respuesta transitoria debe detener la secuencia antes del siguiente tipo automático.
const LOTE_MAXIMO = 1;

// Comprueba estado real de la red y disponibilidad del servidor
export async function getSyncStatus() {
  const isOnline = navigator.onLine;
  if (!isOnline) {
    const count = await getPendingOperationsCount();
    return { online: false, serverReachable: false, pendingCount: count };
  }

  try {
    const server = await checkServerStatus();
    const count = await getPendingOperationsCount();
    return {
      online: true,
      serverReachable: Boolean(server && server.success),
      pendingCount: count
    };
  } catch (_) {
    const count = await getPendingOperationsCount();
    return { online: true, serverReachable: false, pendingCount: count };
  }
}

// ── Firma del evento (misma fórmula que payloadFirmaOffline() en includes/event_signatures.php) ──
function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(String(texto ?? ''));
  let binario = '';
  bytes.forEach((b) => { binario += String.fromCharCode(b); });
  return btoa(binario);
}

async function hmacHex(clave, mensaje) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, '0')).join('');
}

const seisDecimales = (v) => Number(v || 0).toFixed(6);

// Convierte una operación guardada en el formato que espera api/v1/asistencia/offline_sync.php
export async function construirItem(op, tokenSesion, claveDispositivo) {
  if (!belongsToContext(op)) throw new Error('Marcación de otra cuenta o servidor. Se conserva sin enviar.');
  // Compatibilidad con registros guardados por versiones anteriores (hora en ISO/UTC y coordenadas numéricas)
  const timestampLocal = op.timestamp_local
    || (op.timestamp_dispositivo ? horaLima(new Date(op.timestamp_dispositivo)) : horaLima(new Date(op.timestamp_ms || Date.now())));

  const item = {
    id: String(op.local_id),
    trabajador_id: String(op.trabajador_id || op.user_id),
    token_sesion: tokenSesion,
    token_qr: op.qr_data || '',
    codigo: op.codigo || '',
    metodo: op.metodo || (op.qr_data ? 'qr' : 'codigo'),
    tipo: op.tipo || 'auto',
    timestamp_local: timestampLocal,
    latitud: seisDecimales(op.coords && op.coords.latitud),
    longitud: seisDecimales(op.coords && op.coords.longitud)
  };
  // Respaldo si la sesión se cerró o venció (o se entró sin conexión): no forma parte de la firma
  const tokenOffline = getOfflineToken(item.trabajador_id);
  if (tokenOffline) item.token_offline = tokenOffline;
  if (op.motivo_salida) item.motivo_salida = op.motivo_salida;
  if (op.coords && op.coords.precision) item.precision = op.coords.precision;
  if (typeof op.coords?.mock_location === 'boolean') item.mock_location = op.coords.mock_location;

  const partes = ['id', 'trabajador_id', 'token_qr', 'codigo', 'metodo', 'tipo', 'timestamp_local'].map((c) => base64Utf8(item[c]));
  partes.push(item.latitud, item.longitud);
  if (item.motivo_salida) partes.push(base64Utf8(item.motivo_salida));
  item.firma_evento = await hmacHex(claveDispositivo, partes.join('|'));
  return item;
}

// Errores que no son culpa de la marcación: se reintenta más tarde
const esSesionInvalida = (mensaje = '') => /sesi[oó]n (inv[aá]lida|expirada|venci)/i.test(mensaje);
const esErrorTransitorio = (mensaje = '') => /reintentar|conserv|sesi[oó]n|temporalmente|espera unos minutos|demasiados c[oó]digos/i.test(mensaje);
// Tras tantos reintentos el registro pasa a rechazado (visible en Hoy) para no bloquear la cola
const MAX_INTENTOS_TRANSITORIOS = 12;
const proximoIntento =(intentos) => Date.now() + Math.min(300000, 10000 * 2 ** Math.min(intentos, 5));

// Sincroniza la cola de operaciones pendientes cronológicamente
export async function syncPendingOperations(silent = false) {
  if (isSyncing) return { inProgress: true };
  if (silent && document.hidden) return { success: false, reason: 'hidden' };
  isSyncing = true;
  const context = getStoredContext();
  const sessionToken = getToken();
  const sameContext = () => { const current = getStoredContext(); return current.server === context.server && current.worker === context.worker && getToken() === sessionToken; };

  setConnectionStatus('syncing', 'Sincronizando...');

  let syncedCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;
  let serverReachable = false;

  try {
    if (!navigator.onLine) {
      if (!silent) showToast('Sin conexión a Internet para sincronizar.', 'warning');
      return { success: false, reason: 'offline' };
    }

    const user = getUser();
    const token = getToken();
    if (!user || (!token && !getOfflineToken(user.id))) return { success: false, reason: 'no_session' };

    const server = await checkServerStatus();
    if (!sameContext()) return { success: false, reason: 'context_changed' };
    if (!server || !server.success) {
      if (!silent) showToast('Servidor no disponible para sincronización.', 'warning');
      return { success: false, reason: 'server_down' };
    }
    serverReachable = true;

    // Solo las marcaciones del trabajador con sesión iniciada: las de otra persona que usó
    // este celular se conservan hasta que esa persona vuelva a entrar.
    const allOps = await getPendingOperations();
    const queue = allOps.filter((o) =>
      String(o.trabajador_id || o.user_id) === String(user.id) &&
      (o.estado === 'pendiente' || o.estado === 'syncing' || o.estado === 'error')
    );

    if (queue.length === 0) {
      if (!silent) showToast('No hay registros pendientes de sincronización.', 'info');
      return { success: true, syncedCount: 0 };
    }

    const claveDispositivo = getDeviceId();
    for (let i = 0; i < queue.length; i += LOTE_MAXIMO) {
      if (!sameContext() || (silent && document.hidden)) break;
      const lote = queue.slice(i, i + LOTE_MAXIMO);
      // No adelantar registros más nuevos mientras el primero espera su reintento.
      if (silent && (lote[0].next_retry_at || 0) > Date.now()) break;
      const items = [];
      for (const op of lote) {
        await updatePendingOperation(op.local_id, { estado: 'syncing' });
        try { items.push(await construirItem(op, token, claveDispositivo)); }
        catch (e) {
          await updatePendingOperation(op.local_id, { estado: 'rejected', ultimo_error: 'No se pudo preparar la marcación: ' + (e && e.message || e), fecha_rechazo: new Date().toISOString() });
          rejectedCount++;
        }
      }
      if (!sameContext() || (silent && document.hidden)) break;

      const response = await apiRequest('v1/asistencia/offline_sync.php', { method: 'POST', body: { items }, timeoutMs: 30000 });
      if (!sameContext() || response.cancelled) break;
      const resultados = Array.isArray(response.data) ? response.data : null;

      if (!response.success || !resultados) {
        // Fallo de red o del servidor: todo el lote vuelve a pendiente y se reintenta después
        for (const op of lote) {
          const intentos = (op.intentos || 0) + 1;
          await updatePendingOperation(op.local_id, { estado: 'pendiente', intentos, next_retry_at: proximoIntento(intentos), ultimo_error: response.message || 'Error temporal de conexión' });
        }
        errorCount += lote.length;
        break;
      }

      for (const op of lote) {
        const r = resultados.find((x) => String(x.item_id) === String(op.local_id));
        if (r && r.status === 'success') {
          await deletePendingOperation(op.local_id);
          await logSyncEvent({ local_id: op.local_id, tipo: op.tipo, estado: 'synced', mensaje: r.mensaje || 'Marcación sincronizada correctamente' });
          syncedCount++;
        } else if (r && esSesionInvalida(r.mensaje)) {
          // La marca NO se pierde: queda pendiente hasta volver a iniciar sesión con Internet.
          markNeedsOnline();
          await updatePendingOperation(op.local_id, { estado: 'pendiente', ultimo_error: r.mensaje, next_retry_at: proximoIntento(5) });
          errorCount++;
        } else if ((!r || esErrorTransitorio(r.mensaje)) && (op.intentos || 0) + 1 < MAX_INTENTOS_TRANSITORIOS) {
          const intentos = (op.intentos || 0) + 1;
          await updatePendingOperation(op.local_id, { estado: 'pendiente', intentos, next_retry_at: proximoIntento(intentos), ultimo_error: (r && r.mensaje) || 'Sin respuesta del servidor' });
          errorCount++;
        } else {
          // Rechazo definitivo (QR vencido, fuera de la sede, etc.): se guarda para que el trabajador lo vea
          const mensaje = (r && r.mensaje) || 'Sin respuesta del servidor tras varios intentos';
          await updatePendingOperation(op.local_id, { estado: 'rejected', ultimo_error: mensaje, fecha_rechazo: new Date().toISOString() });
          await logSyncEvent({ local_id: op.local_id, tipo: op.tipo, estado: 'rejected', mensaje });
          rejectedCount++;
        }
      }
      if (errorCount > 0) break;
    }

    if (!sameContext()) return { success: false, reason: 'context_changed' };

    if (syncedCount > 0) {
      showToast(`${syncedCount} marcación${syncedCount > 1 ? 'es' : ''} sincronizada${syncedCount > 1 ? 's' : ''} con éxito.`, 'success');
    }
    if (rejectedCount > 0) {
      showToast(`${rejectedCount} marcación${rejectedCount > 1 ? 'es fueron rechazadas' : ' fue rechazada'} por el servidor. Revisa el detalle en Inicio.`, 'danger');
    }

    window.dispatchEvent(new CustomEvent('sync:completed', {
      detail: { syncedCount, rejectedCount, errorCount }
    }));

    return { success: true, syncedCount, rejectedCount, errorCount };
  } catch (error) {
    console.warn('Error al sincronizar:', error);
    return { success: false, reason: 'exception', error: error.message };
  } finally {
    isSyncing = false;

    const pendingRemaining = await getPendingOperationsCount();
    if (!navigator.onLine) {
      setConnectionStatus('offline', 'Sin conexión');
    } else if (!serverReachable) {
      // Hay Wi-Fi/datos pero el servidor no contestó: no mostrar "En línea"
      setConnectionStatus('offline', 'Sin servidor');
    } else if (pendingRemaining > 0) {
      setConnectionStatus('syncing', `Pendientes: ${pendingRemaining}`);
    } else {
      setConnectionStatus('online', 'En línea');
    }
  }
}

// Inicializa listeners automáticos para sincronización al recuperar conexión
export function initSyncManager() {
  const intentar = async () => {
    if (document.hidden || !navigator.onLine || isSyncing) return;
    const count = await getPendingOperationsCount();
    if (count > 0) await syncPendingOperations(true);
  };

  // 1. Al recuperar la conexión
  window.addEventListener('online', () => setTimeout(intentar, 1500));

  // 2. Comprobación periódica cada 60 segundos si hay pendientes
  setInterval(intentar, 60000);

  // 3. Al volver a abrir la app (iOS no permite sincronizar en segundo plano)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') intentar();
  });

  // 4. Al arrancar: si ya hay Internet no se espera al primer intervalo
  setTimeout(intentar, 2000);
}
