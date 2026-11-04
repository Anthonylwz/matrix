// Módulo de base de datos local IndexedDB
import { getStoredContext, belongsToContext } from './server-context.js';
const DB_NAME = 'asistencia_ideas_db';
const DB_VERSION = 2;

let dbInstance = null;
let opening = null;

// Abre la conexión con la base de datos IndexedDB.
// Safari a veces deja indexedDB.open() sin responder (sobre todo en la app instalada
// tras una actualización): con el límite de tiempo la app sigue funcionando en lugar
// de quedarse esperando para siempre.
export function initDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (opening) return opening;
  opening = openDB().finally(() => { opening = null; });
  return opening;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB no disponible'));

    const timer = setTimeout(() => reject(new Error('IndexedDB no respondió')), 5000);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      return done(reject, err);
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Caché de perfil de usuario
      if (!db.objectStoreNames.contains('users_cache')) {
        db.createObjectStore('users_cache', { keyPath: 'id' });
      }

      // Caché de historial reciente
      if (!db.objectStoreNames.contains('attendance_cache')) {
        db.createObjectStore('attendance_cache', { keyPath: 'id' });
      }

      // Cola de operaciones pendientes offline
      if (!db.objectStoreNames.contains('pending_operations')) {
        const store = db.createObjectStore('pending_operations', { keyPath: 'local_id' });
        store.createIndex('estado', 'estado', { unique: false });
        store.createIndex('timestamp_ms', 'timestamp_ms', { unique: false });
      }

      // Configuraciones locales de la aplicación
      if (!db.objectStoreNames.contains('app_settings')) {
        db.createObjectStore('app_settings', { keyPath: 'clave' });
      }

      // Registro de eventos de sincronización
      if (!db.objectStoreNames.contains('sync_log')) {
        db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
      }

      // Control anti-reutilización de nonces QR firmados
      if (!db.objectStoreNames.contains('used_nonces')) {
        const store = db.createObjectStore('used_nonces', { keyPath: 'nonce' });
        store.createIndex('expira_en', 'expira_en', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      // Si otra pestaña actualiza la base o Safari la cierra, se vuelve a abrir en el siguiente uso
      db.onversionchange = () => { db.close(); dbInstance = null; };
      db.onclose = () => { dbInstance = null; };
      dbInstance = db;
      done(resolve, db);
    };

    request.onerror = (event) => {
      done(reject, event.target.error);
    };

    // Otra pestaña con la versión anterior abierta: no esperar indefinidamente
    request.onblocked = () => {
      done(reject, new Error('IndexedDB bloqueada por otra pestaña'));
    };
  });
}

// Guarda lista de historial en caché local
// replace: borra lo anterior (lista completa); si no, solo agrega/actualiza esos días
export async function cacheAttendanceHistory(records, { replace = true, from = null, to = null } = {}) {
  if (!Array.isArray(records)) return;
  const context = getStoredContext();
  if (!context.worker) return;
  try {
    const db = await initDB();
    const tx = db.transaction('attendance_cache', 'readwrite');
    const store = tx.objectStore('attendance_cache');
    if (replace && from && to) {
      const currentIds = new Set(records.map((item) => String(item.id)));
      const request = store.getAll();
      request.onsuccess = () => {
        (request.result || []).forEach((item) => {
          if (belongsToContext(item, context) && item.fecha >= from && item.fecha <= to && !currentIds.has(String(item.id))) store.delete(item.id);
        });
      };
    } else if (replace) store.clear();
    for (const item of records) {
      if (item && item.id) {
        store.put({ ...item, owner_id: context.worker, server_key: context.server });
      }
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('No se pudo guardar el historial.'));
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el historial.'));
    });
  } catch (err) {
    console.warn('Error al guardar caché de historial:', err);
  }
}

// Cobertura de la última descarga completa, separada por cuenta y servidor.
export async function cacheHistoryCoverage(from, to) {
  const context = getStoredContext();
  if (!context.worker) return;
  try {
    const db = await initDB();
    const tx = db.transaction('app_settings', 'readwrite');
    tx.objectStore('app_settings').put({ clave: `history|${context.server}|${context.worker}`, from, to, saved_at: new Date().toISOString() });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; tx.onerror = reject; });
  } catch (_) {}
}

export async function getHistoryCoverage() {
  const context = getStoredContext();
  try {
    const db = await initDB();
    return await new Promise((resolve) => {
      const request = db.transaction('app_settings', 'readonly').objectStore('app_settings').get(`history|${context.server}|${context.worker}`);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (_) { return null; }
}

// Obtiene el historial guardado en caché local
export async function getCachedAttendanceHistory() {
  const context = getStoredContext();
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('attendance_cache', 'readonly');
      const store = tx.objectStore('attendance_cache');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter((item) => belongsToContext(item, context)));
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

// Guarda una marcación en la cola de pendientes offline
export async function savePendingOperation(data) {
  const context = getStoredContext();
  if (!belongsToContext({ ...data, server_key: data.server_key || context.server }, context)) {
    throw new Error('La cuenta o el servidor cambió. Vuelve a iniciar la marcación.');
  }
  try {
    const db = await initDB();
    const now = new Date();
    const localId = data.local_id || data.id || (crypto.randomUUID ? crypto.randomUUID() : 'offline_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

    const record = {
      local_id: localId,
      server_key: context.server,
      online_uncertain: data.online_uncertain === true,
      user_id: data.user_id || data.trabajador_id,
      trabajador_id: data.trabajador_id || data.user_id,
      tipo: data.tipo || 'auto',
      metodo: data.metodo || (data.token_qr ? 'qr' : 'codigo'),
      qr_data: data.token_qr || data.qr_data || null,
      codigo: data.codigo || null,
      timestamp_local: data.timestamp_local || null, // hora de Lima de la captura (la valida el servidor)
      timestamp_dispositivo: data.timestamp_dispositivo || data.timestamp_local || now.toISOString(),
      timestamp_ms: data.timestamp_ms || now.getTime(),
      coords: data.coords || null,
      motivo_salida: data.motivo_salida || null,
      nonce: data.nonce || null,
      estado: 'pendiente', // 'pendiente', 'syncing', 'synced', 'error', 'rejected'
      intentos: 0,
      ultimo_error: null,
      creado_en: now.toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_operations', 'readwrite');
      const store = tx.objectStore('pending_operations');
      store.put(record);
      // El éxito del request precede al commit; sólo confirmamos cuando la transacción termina.
      tx.oncomplete = () => resolve(record);
      tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la marcación en el celular.'));
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la marcación en el celular.'));
    });
  } catch (err) {
    console.error('Error al guardar operación offline:', err);
    throw err;
  }
}

// Obtiene todas las operaciones pendientes ordenadas cronológicamente
export async function getPendingOperations({ retained = false } = {}) {
  const context = getStoredContext();
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('pending_operations', 'readonly');
      const store = tx.objectStore('pending_operations');
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []).filter((item) => retained
          ? Boolean(context.worker && !item.server_key && String(item.trabajador_id || item.user_id) === context.worker)
          : belongsToContext(item, context));
        // Ordenar del más antiguo al más reciente
        items.sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

// Obtiene la cantidad de marcaciones pendientes
export async function getPendingOperationsCount() {
  return (await getPendingOperations()).filter((o) => o.estado !== 'rejected').length;
}

// Actualiza una operación pendiente existente
export async function updatePendingOperation(localId, updates) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_operations', 'readwrite');
      const store = tx.objectStore('pending_operations');
      const getReq = store.get(localId);
      let result = null;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('No se pudo actualizar la marcación.'));
      tx.onerror = () => reject(tx.error || new Error('No se pudo actualizar la marcación.'));

      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) return;
        const updated = { ...existing, ...updates };
        store.put(updated);
        result = updated;
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn('Error al actualizar operación pendiente:', err);
    return null;
  }
}

// Elimina una operación pendiente sincronizada
export async function deletePendingOperation(localId) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_operations', 'readwrite');
      const store = tx.objectStore('pending_operations');
      store.delete(localId);
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('No se pudo completar la sincronización local.'));
      tx.onerror = () => reject(tx.error || new Error('No se pudo completar la sincronización local.'));
    });
  } catch (_) {
    return false;
  }
}

// Registra un evento en sync_log
export async function logSyncEvent(eventData) {
  const context = getStoredContext();
  if (!context.worker) return;
  try {
    const db = await initDB();
    const tx = db.transaction('sync_log', 'readwrite');
    const store = tx.objectStore('sync_log');
    store.add({
      ...eventData,
      owner_id: context.worker,
      server_key: context.server,
      timestamp: new Date().toISOString()
    });
  } catch (_) {}
}

// Obtiene logs recientes de sincronización
export async function getSyncLogs(limit = 20) {
  const context = getStoredContext();
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('sync_log', 'readonly');
      const store = tx.objectStore('sync_log');
      const req = store.getAll();
      req.onsuccess = () => {
        const logs = (req.result || []).filter((item) => belongsToContext(item, context));
        logs.reverse();
        resolve(logs.slice(0, limit));
      };
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

// Guarda o actualiza el perfil en caché local
export async function cacheUserProfile(userData) {
  if (!userData || !userData.id) return;
  const context = getStoredContext();
  if (String(userData.id) !== context.worker) return;
  try {
    const db = await initDB();
    const tx = db.transaction('users_cache', 'readwrite');
    tx.objectStore('users_cache').put({ ...userData, owner_id: context.worker, server_key: context.server });
  } catch (err) {
    console.warn('Error al cachear usuario:', err);
  }
}

// Obtiene el perfil de usuario desde la caché local
export async function getCachedUserProfile(id) {
  const context = getStoredContext();
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('users_cache', 'readonly');
      const store = tx.objectStore('users_cache');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result && belongsToContext({ ...req.result, owner_id: req.result.id }, context) ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

// Verifica si un nonce de QR firmado ya fue utilizado previamente (anti-replay)
export async function isNonceUsed(nonce) {
  if (!nonce) return false;
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('used_nonces', 'readonly');
      const store = tx.objectStore('used_nonces');
      const req = store.get(nonce);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch (_) {
    return false;
  }
}

// Registra un nonce de QR firmado como consumido localmente
export async function recordUsedNonce(nonce, expiraEn = null, tipo = null) {
  if (!nonce) return;
  try {
    const db = await initDB();
    const tx = db.transaction('used_nonces', 'readwrite');
    const store = tx.objectStore('used_nonces');
    store.put({
      nonce,
      usado_en: new Date().toISOString(),
      expira_en: expiraEn,
      tipo: tipo
    });
  } catch (err) {
    console.warn('Error al registrar nonce consumido:', err);
  }
}

// Limpia nonces expirados hace más de 24 horas para mantener optimizado el almacenamiento
export async function cleanExpiredNonces() {
  try {
    const db = await initDB();
    const tx = db.transaction('used_nonces', 'readwrite');
    const store = tx.objectStore('used_nonces');
    const now = Math.floor(Date.now() / 1000);
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const item = cursor.value;
        if (item.expira_en && item.expira_en < now - 86400) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch (_) {}
}

