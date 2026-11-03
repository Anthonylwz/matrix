// Capa centralizada de comunicación con la API REST PHP
import { markNeedsOnline, getToken, getUser, getDeviceId, isOfflineSession } from './auth.js';
import { savePendingOperation, deletePendingOperation, getPendingOperations } from './db.js';
import { getLocationForMark, locationErrorMessage } from './location.js';
import { getServerKey } from './server-context.js';

// URL base de la API. Puede sobreescribirse si la PWA se aloja en otro dominio o subcarpeta.
export const API_BASE_URL = window.APP_API_URL || '../api/';

// Cliente HTTP genérico para endpoints JSON
export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  const initialServer = getServerKey();
  const initialToken = getToken();
  const initialWorker = String(getUser()?.id || '');
  const requestBodies = options.body?.items || [options.body];
  const authenticatedRequest = Boolean(initialToken && Array.isArray(requestBodies) && requestBodies.some((item) =>
    item?.token_sesion === initialToken && String(item?.trabajador_id || '') === initialWorker));
  const unchangedSession = () => initialServer === getServerKey() && initialToken === getToken()
    && initialWorker === String(getUser()?.id || '');
  const cancelledResult = () => ({ status: 0, success: false, cancelled: true, message: '' });
  if (options.signal?.aborted) return cancelledResult();

  const defaultHeaders = {
    'Accept': 'application/json'
  };

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  // Sin límite de tiempo, una red móvil mala deja la petición colgada indefinidamente.
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  options.signal?.addEventListener('abort', onCancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  const config = {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: { ...defaultHeaders, ...options.headers },
    body: body,
    cache: 'no-store',
    signal: controller.signal
  };

  try {
    const response = await fetch(url, config);
    let data;
    let invalidResponse = false;
    try {
      data = await response.json();
    } catch (_) {
      if (controller.signal.aborted) throw new DOMException('Solicitud interrumpida', 'AbortError');
      invalidResponse = true;
      data = {
        success: false,
        message: response.status === 401 ? 'Sesión expirada' : 'Respuesta no válida del servidor'
      };
    }
    if (options.signal?.aborted || !unchangedSession()) return cancelledResult();
    if (!data || typeof data !== 'object' || Array.isArray(data)) { data = {}; invalidResponse = true; }
    if (![true, false, 0, 1].includes(data.success)) invalidResponse = true;

    // Normalizar formato de respuesta
    const result = {
      status: response.status,
      success: data.success === true || data.success === 1,
      message: data.message || data.mensaje || (invalidResponse ? 'Respuesta no válida del servidor' : ''),
      data: data.data || data.datos || null,
      raw: data,
      invalidResponse
    };

    // Si el servidor rechaza la sesión (401) en un endpoint privado: se bloquea la app y se pide
    // entrar con Internet. La cuenta y las marcaciones pendientes se conservan.
    if (response.status === 401 && authenticatedRequest && !endpoint.includes('login_app.php')) {
      markNeedsOnline();
      if (window.location.hash !== '#login') {
        window.location.hash = '#login';
      }
    }

    return result;
  } catch (error) {
    if (options.signal?.aborted || !unchangedSession()) return cancelledResult();
    // Avisa al indicador de conexión: no esperar a la próxima comprobación periódica
    window.dispatchEvent(new Event('api:unreachable'));
    return {
      status: 0,
      success: false,
      message: 'Sin conexión con el servidor',
      offline: true,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCancel);
  }
}

// Comprueba estado real del servidor y base de datos
export async function checkServerStatus(options = {}) {
  return await apiRequest('estado_servidor.php', { signal: options.signal, timeoutMs: options.timeoutMs });
}

// Desvincula este celular en el servidor (anula sesión, notificaciones y credencial sin conexión)
export async function unlinkDeviceService() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'Entra con Internet para desvincular el celular.' };
  return await apiRequest('cerrar_sesion_app.php', {
    method: 'POST',
    body: { trabajador_id: user.id, token_sesion: token }
  });
}

// Servicio de autenticación: login con DNI y contraseña
export async function loginService(dni, password, deviceData = {}, options = {}) {
  return await apiRequest('login_app.php', {
    method: 'POST',
    timeoutMs: options.timeoutMs,
    body: {
      dni: dni.trim(),
      password: password,
      device_token: deviceData.deviceToken || '',
      device_name: deviceData.deviceName || 'iPhone (Safari PWA)',
      device_model: deviceData.deviceModel || 'iPhone',
      device_os: deviceData.deviceOs || 'iOS'
    }
  });
}

// Obtiene el perfil actualizado desde el servidor
export async function getProfileService(trabajadorId, tokenSesion) {
  const user = getUser();
  const tid = trabajadorId || user?.id;
  const token = tokenSesion || getToken();

  return await apiRequest('get_perfil.php', {
    method: 'POST',
    body: {
      trabajador_id: tid,
      token_sesion: token
    }
  });
}

// Consulta el estado actual de la jornada de hoy
export async function getJornadaService() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('jornada.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token
    }
  });
}

// Consulta el historial de asistencias con filtros (hoy, semana, mes, todo)
export function getHistoryPeriodBounds(filtro, day = horaLima().slice(0, 10)) {
  const count = { hoy: 1, semana: 7, mes: 30 }[filtro];
  if (!count) return null;
  const start = new Date(`${day}T12:00:00-05:00`);
  start.setUTCDate(start.getUTCDate() - (count - 1));
  return { fecha_inicio: horaLima(start).slice(0, 10), fecha_fin: day };
}

export async function getHistoryService(filtro = 'todo', options = {}) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };
  const period = options.fecha_inicio && options.fecha_fin
    ? { fecha_inicio: options.fecha_inicio, fecha_fin: options.fecha_fin }
    : getHistoryPeriodBounds(filtro);

  const response = await apiRequest('historial.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      filtro,
      ...(Number.isInteger(options.offset) ? { offset: options.offset } : {}),
      ...(Number.isInteger(options.limite) ? { limite: options.limite } : {}),
      ...(period || {})
    },
    signal: options.signal
  });
  // Un servidor anterior puede ignorar las fechas nuevas. No mostrar el octavo/trigésimo primer día.
  if (period && response.success && !response.data?.meta && Array.isArray(response.data?.historial)) {
    const list = response.data.historial.filter((item) => item.fecha >= period.fecha_inicio && item.fecha <= period.fecha_fin);
    const minutes = list.reduce((sum, item) => {
      const match = /^(\d+):(\d{2})/.exec(String(item.horas_trabajadas || ''));
      return sum + (match ? Number(match[1]) * 60 + Number(match[2]) : 0);
    }, 0);
    response.data = { ...response.data, historial: list, resumen: {
      total_asistencias: list.filter((item) => item.estado_general === 'presente' || (item.hora_entrada && item.estado_general !== 'falta')).length,
      total_tardanzas: list.filter((item) => ['tarde', 'tarde_grave'].includes(item.estado_entrada)).length,
      total_faltas: list.filter((item) => ['falta', 'ausente'].includes(item.estado_general)).length,
      horas_trabajadas: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
    } };
  }
  return response;
}

// El calendario tiene un rango acotado; se acumulan sus páginas antes de declarar días sin registros.
export async function getHistoryRangeService(from, to, { signal } = {}) {
  const server = getServerKey();
  const worker = String(getUser()?.id || '');
  const token = getToken();
  const isCurrent = () => !signal?.aborted && server === getServerKey() && worker === String(getUser()?.id || '') && token === getToken();
  const records = new Map();
  let offset = 0;
  let last = null;
  for (let page = 0; page < 12; page++) {
    if (!isCurrent()) return { success: false, cancelled: true, message: '' };
    const response = await getHistoryService('todo', { fecha_inicio: from, fecha_fin: to, offset, limite: 100, signal });
    if (!isCurrent()) return { success: false, cancelled: true, message: '' };
    if (!response.success || !Array.isArray(response.data?.historial)) return { ...response, partialRecords: [...records.values()] };
    const list = response.data.historial;
    list.forEach((item) => records.set(String(item.id), item));
    const meta = response.data.meta;
    last = response;
    if (!meta || meta.has_more !== true) {
      return { ...response, data: { ...response.data, historial: [...records.values()], range_complete: Boolean(meta && meta.has_more === false && meta.from === from && meta.to === to && Number(meta.total) === records.size) } };
    }
    if (!list.length) break;
    offset += list.length;
  }
  return { ...last, data: { ...(last?.data || {}), historial: [...records.values()], range_complete: false } };
}

// Actualiza el número de teléfono del trabajador
export async function updateProfileService(changes = {}) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'Entra con Internet para actualizar tus datos.' };
  const fields = {};
  for (const field of ['telefono', 'email']) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) fields[field] = String(changes[field] ?? '').trim();
  }
  return await apiRequest('actualizar_perfil.php', {
    method: 'POST',
    body: { trabajador_id: user.id, token_sesion: token, ...fields }
  });
}

export async function updatePhoneService(telefono) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('actualizar_telefono.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      telefono: String(telefono).trim()
    }
  });
}

// Cambia la contraseña del trabajador
export async function changePasswordService(passwordActual, passwordNueva) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('cambiar_password.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      password_actual: passwordActual,
      password_nueva: passwordNueva
    }
  });
}

// Sube la foto de perfil ya recortada y comprimida (data URL JPEG).
// Va como JSON porque el puente de red de la app Android solo transporta texto.
export async function uploadProfilePhotoService(dataUrl) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('subir_foto_perfil.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      foto_base64: dataUrl
    },
    timeoutMs: 30000
  });
}

// Envía marcación de asistencia (online con fallback offline automático)
export async function marcarAsistenciaService(params = {}, { signal } = {}) {
  const user = getUser();
  const token = getToken();
  const sinConexion = isOfflineSession();
  const serverKey = getServerKey();
  const cancelled = () => ({ success: false, cancelled: true, message: '' });
  const isCurrent = () => !signal?.aborted && serverKey === getServerKey()
    && String(user?.id) === String(getUser()?.id) && token === getToken();
  if (!isCurrent()) return cancelled();
  if (!user || (!token && !sinConexion)) return { success: false, message: 'No autenticado' };
  if (navigator.onLine && !sinConexion && (!params.tipo || params.tipo === 'auto')) {
    const uncertain = (await getPendingOperations()).find((op) => op.online_uncertain && op.estado !== 'rejected' && op.local_id !== params.id);
    if (!isCurrent()) return cancelled();
    if (uncertain) return {
      success: false, pendiente: true, needsSync: true,
      message: 'Hay una marcación pendiente de confirmar. Vuelve a Hoy y abre Sincronización para reintentar antes de escanear de nuevo.',
      data: { local_id: uncertain.local_id, route: '#home?sync=1' }
    };
  }

  // La hora y el GPS se capturan en el momento del escaneo: si la marcación queda pendiente,
  // el servidor la valida con estos datos (no con la hora en que se sincroniza).
  const now = new Date();
  // La ubicación se viene buscando desde que se abrió la pantalla de marcar (location.js)
  const loc = await getLocationForMark(navigator.onLine ? 12000 : 15000, { signal });
  if (!isCurrent() || loc.error === 'cancelled') return cancelled();
  const coords = loc.coords || null;

  // Sin ubicación el servidor rechaza siempre ("Activa el GPS…"): se avisa aquí con la causa
  // concreta y no se envía (tampoco cuenta como intento fallido)
  if (!coords) {
    return { success: false, locationError: loc.error || 'timeout', message: locationErrorMessage(loc.error) };
  }

  const payload = {
    server_key: serverKey,
    trabajador_id: user.id,
    user_id: user.id,
    token_sesion: token,
    device_token: getDeviceId(),
    metodo: params.metodo || (params.token_qr ? 'qr' : 'codigo'),
    token_qr: params.token_qr || '',
    codigo: params.codigo || '',
    tipo: params.tipo || 'auto',
    id: params.id || (crypto.randomUUID ? crypto.randomUUID() : 'pwa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    timestamp_local: horaLima(now),
    timestamp_dispositivo: horaLima(now),
    timestamp_ms: now.getTime()
  };

  if (coords) {
    payload.latitud = coords.latitud;
    payload.longitud = coords.longitud;
    payload.precision = coords.precision;
    payload.coords = coords;
    if (typeof coords.mock_location === 'boolean') payload.mock_location = coords.mock_location;
  }

  if (params.motivo_salida) {
    payload.motivo_salida = params.motivo_salida;
  }

  if (params.nonce) {
    payload.nonce = params.nonce;
  }

  let offlineRecord = null;
  const guardarPendiente = async (motivo, alreadyDispatched = false) => {
    if (!alreadyDispatched && !isCurrent()) return cancelled();
    if (!coords) {
      return {
        success: false,
        message: 'Sin conexión: activa el GPS y vuelve a escanear para guardar la marcación y enviarla después.'
      };
    }
    if (!offlineRecord) offlineRecord = await savePendingOperation(payload);
    return {
      success: true,
      offline: true,
      pendiente: true,
      message: `${motivo}. Marcación guardada en el celular`,
      data: {
        tipo: payload.tipo,
        hora: payload.timestamp_local.slice(11, 16),
        estado: 'Pendiente de sincronización',
        local_id: offlineRecord.local_id
      }
    };
  };

  // 1. Si no hay conexión a Internet, guardar directamente en IndexedDB
  if (!navigator.onLine) {
    return guardarPendiente('Sin internet');
  }
  // Sesión abierta sin conexión: no hay token para marcar en vivo; se guarda y se sincroniza
  // con la credencial del celular
  if (sinConexion) {
    return guardarPendiente('Entraste sin conexión');
  }

  // Primero se confirma la escritura local: cerrar el proceso durante el POST no pierde el evento.
  // El mismo identificador sirve para el envío en vivo y todos sus reintentos.
  if (!isCurrent()) return cancelled();
  payload.online_uncertain = true;
  offlineRecord = await savePendingOperation(payload);
  if (!isCurrent()) {
    await deletePendingOperation(offlineRecord.local_id);
    return cancelled();
  }

  // 2. Si hay Internet, intentar enviar al servidor
  const res = await apiRequest('marcar_asistencia.php', {
    method: 'POST',
    body: payload,
    // Como la app anterior: si el servidor no contesta pronto, se guarda en el celular
    timeoutMs: 5000,
    signal
  });

  if (res.cancelled) return { ...cancelled(), pendiente: true };

  // 3. Si falló por red o el servidor no está disponible (caída, mantenimiento, proxy del hosting)
  // (429 no: es un bloqueo por intentos fallidos y se muestra su mensaje real)
  if (res.offline || res.invalidResponse || res.status === 0 || [408, 425, 500, 502, 503, 504].includes(res.status)) {
    return guardarPendiente('Servidor no disponible', true);
  }

  // Sesión vencida justo al marcar: la marca se conserva y se envía tras volver a iniciar sesión
  if (res.status === 401) return { ...res, pendiente: true };

  // 4. Si el servidor respondió con confirmación o rechazo definitivo
  await deletePendingOperation(offlineRecord.local_id);
  return res;
}

// Fecha y hora en America/Lima con formato "YYYY-MM-DD HH:mm:ss" (lo que espera el servidor)
export function horaLima(fecha = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(fecha).replace('T', ' ');
}


// Obtiene el listado de permisos del trabajador
export async function getPermissionsService() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('permisos.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token
    }
  });
}

// Envía una nueva solicitud de permiso
export async function requestPermissionService(data = {}) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('solicitar_permiso.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      tipo_permiso: data.tipo_permiso,
      motivo: data.motivo,
      hora_salida_estimada: data.hora_salida_estimada,
      hora_retorno_estimada: data.hora_retorno_estimada,
      duracion_minutos: data.duracion_minutos || 30,
      fecha: data.fecha || '',
      dia_completo: Boolean(data.dia_completo)
    }
  });
}

// Obtiene el listado de solicitudes de corrección
export async function getCorrectionsService() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('correcciones.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token
    }
  });
}

// ── Notificaciones y anuncios (mismas rutas que usaba la app nativa anterior) ──
function sessionBody(extra = {}) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return null;
  return { trabajador_id: user.id, token_sesion: token, ...extra };
}
const NO_AUTH = { success: false, message: 'No autenticado' };

export async function getNotificationsService(limite = 50, offset = 0) {
  const body = sessionBody({ limite, offset });
  return body ? apiRequest('notificaciones.php', { method: 'POST', body }) : NO_AUTH;
}

export async function markNotificationReadService(id) {
  const body = sessionBody({ notificacion_id: id });
  return body ? apiRequest('marcar_notificacion_leida.php', { method: 'POST', body }) : NO_AUTH;
}

export async function markAllNotificationsReadService() {
  const body = sessionBody();
  return body ? apiRequest('marcar_notificaciones_leidas.php', { method: 'POST', body }) : NO_AUTH;
}

export async function deleteNotificationService(id) {
  const body = sessionBody({ notificacion_id: id });
  return body ? apiRequest('eliminar_notificacion.php', { method: 'POST', body }) : NO_AUTH;
}

export async function deleteAllNotificationsService() {
  const body = sessionBody();
  return body ? apiRequest('eliminar_notificaciones.php', { method: 'POST', body }) : NO_AUTH;
}

export async function getAnnouncementsService() {
  const body = sessionBody();
  if (!body) return NO_AUTH;
  const qs = new URLSearchParams(body).toString();
  return apiRequest(`v1/anuncios/listar.php?${qs}`, { method: 'GET' });
}

export async function confirmAnnouncementService(anuncioId) {
  const body = sessionBody({ anuncio_id: anuncioId });
  return body ? apiRequest('v1/anuncios/confirmar.php', { method: 'POST', body }) : NO_AUTH;
}

// Cursor liviano: cambia cuando hay algo nuevo para el trabajador (marcación, respuesta, aviso)
export async function getAppRevisionService() {
  const body = sessionBody();
  return body ? apiRequest('cambios_app.php', { method: 'POST', body, timeoutMs: 8000 }) : NO_AUTH;
}

export async function sendTestPushService() {
  const body = sessionBody();
  return body ? apiRequest('probar_notificacion_fcm.php', { method: 'POST', body, timeoutMs: 30000 }) : NO_AUTH;
}

export async function setPushPreferenceService(enabled) {
  const body = sessionBody({ accion: 'preferencia', notificaciones_habilitadas: enabled });
  return body ? apiRequest('registrar_fcm.php', { method: 'POST', body }) : NO_AUTH;
}

export async function getPushStatusService() {
  const body = sessionBody({ accion: 'estado' });
  return body ? apiRequest('registrar_fcm.php', { method: 'POST', body }) : NO_AUTH;
}

// Envía una nueva solicitud de corrección de asistencia
export async function requestCorrectionService(data = {}) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return { success: false, message: 'No autenticado' };

  return await apiRequest('solicitar_correccion.php', {
    method: 'POST',
    body: {
      trabajador_id: user.id,
      token_sesion: token,
      tipo_correccion: data.tipo_correccion,
      descripcion: data.descripcion,
      fecha_referencia: data.fecha_referencia,
      campo_corregir: data.campo_corregir || 'ninguno',
      hora_propuesta: data.hora_propuesta || ''
    }
  });
}



