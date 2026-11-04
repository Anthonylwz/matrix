// Ubicación para marcar asistencia. El servidor conserva la decisión sobre sede y precisión.
const FRESH_MS = 2 * 60 * 1000;
export const MARK_FRESH_MS = 15000;
const GOOD_ACCURACY_M = 60; // Sólo evita una espera adicional; no sustituye la validación del servidor.
const NATIVE_TIMEOUT_MS = 47000;

let watchId = null;
let nativeTimer = null;
let nativePending = null;
let nativeSeq = 0;
const nativeDocumentId = 'loc_' + (window.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14));
let generation = 0;
let best = null;
let lastError = null;
const listeners = new Set();
const markWaiters = new Set();
const nativeBridge = () => (window.AndroidNet && typeof window.AndroidNet.getNativeLocation === 'function' ? window.AndroidNet : null);
const isHidden = () => typeof document !== 'undefined' && document.hidden;
function accuracyPermission() {
  try { return nativeBridge()?.locationAccuracyAuthorization?.() || null; } catch (_) { return null; }
}

function fresh(fix) {
  const age = fix ? Date.now() - fix.at : Infinity;
  return age >= -1000 && age < FRESH_MS;
}
function markFresh(fix) { return fresh(fix) && Date.now() - fix.at <= MARK_FRESH_MS; }

export function getLocationState() {
  if (!nativeBridge() && !('geolocation' in navigator)) return { status: 'unsupported' };
  if (lastError === 'denied' || lastError === 'unavailable') return { status: lastError };
  if (fresh(best)) return { status: !markFresh(best) ? 'updating' : best.accuracy <= GOOD_ACCURACY_M ? 'ready' : 'imprecise', accuracy: Math.round(best.accuracy), permissionAccuracy: accuracyPermission() };
  return { status: lastError === 'timeout' ? 'timeout' : 'searching' };
}

function emit() {
  const state = getLocationState();
  listeners.forEach((fn) => { try { fn(state); } catch (_) {} });
}

export function onLocationChange(fn) {
  listeners.add(fn);
  fn(getLocationState());
  return () => listeners.delete(fn);
}

function accept(pos, requestGeneration) {
  if (requestGeneration !== generation || isHidden()) return;
  const c = pos && pos.coords;
  const timestamp = pos && pos.timestamp;
  if (!c || !Number.isFinite(c.latitude) || Math.abs(c.latitude) > 90 || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180 || !Number.isFinite(timestamp)) return;
  const fix = { lat: c.latitude, lon: c.longitude, accuracy: Number.isFinite(c.accuracy) && c.accuracy > 0 ? c.accuracy : 9999, at: timestamp };
  if (typeof pos.is_mock === 'boolean') fix.is_mock = pos.is_mock;
  // Nunca rejuvenecer una posición almacenada asignándole la hora de recepción.
  if (!fresh(fix)) return;
  if (!markFresh(best) || fix.accuracy <= best.accuracy || Date.now() - best.at > 30000) best = fix;
  lastError = null;
  emit();
}

function fail(err, requestGeneration) {
  if (requestGeneration !== generation || isHidden()) return;
  if (err && err.code === 1) { lastError = 'denied'; best = null; }
  else if (err && err.code === 2) lastError = lastError === 'denied' ? 'denied' : 'unavailable';
  else if (!fresh(best)) lastError = lastError || 'timeout';
  emit();
}

function cancelNative() {
  const pending = nativePending;
  nativePending = null;
  if (!pending) return;
  clearTimeout(pending.timer);
  try { nativeBridge()?.cancelNativeLocation?.(pending.id); } catch (_) {}
}

window.__nativeLocationDone = (id, json) => {
  const pending = nativePending;
  if (!pending || pending.id !== String(id)) return;
  nativePending = null;
  clearTimeout(pending.timer);
  if (pending.generation !== generation || isHidden()) return;
  let result = {};
  try { result = JSON.parse(json || '{}'); } catch (_) {}
  if (result.error === 'cancelled') { markWaiters.forEach((finish) => finish({ error: 'cancelled' })); return; }
  if (Number.isFinite(result.lat) && Number.isFinite(result.lon)) {
    accept({ timestamp: result.timestamp_ms ?? result.timestamp, is_mock: result.is_mock, coords: { latitude: result.lat, longitude: result.lon, accuracy: result.accuracy } }, pending.generation);
  } else fail({ code: result.error === 'denied' ? 1 : result.error === 'unavailable' ? 2 : 3 }, pending.generation);
};

function nativeRequest() {
  const bridge = nativeBridge();
  if (!bridge || nativePending || isHidden()) return;
  const pending = { id: nativeDocumentId + '_' + (++nativeSeq), generation, timer: null };
  nativePending = pending;
  pending.timer = setTimeout(() => {
    if (nativePending !== pending) return;
    cancelNative();
    fail({ code: 3 }, pending.generation);
  }, NATIVE_TIMEOUT_MS);
  try { bridge.getNativeLocation(pending.id); }
  catch (_) { cancelNative(); fail({ code: 2 }, pending.generation); }
}

export function usesNativeLocation() { return Boolean(nativeBridge()); }

export async function locationPermissionState() {
  const bridge = nativeBridge();
  if (bridge && typeof bridge.locationPermission === 'function') {
    try { return bridge.locationPermission(); } catch (_) { return 'prompt'; }
  }
  if (!('geolocation' in navigator)) return 'unsupported';
  try {
    if (navigator.permissions?.query) return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch (_) {}
  return 'prompt';
}

export async function prewarmLocation() {
  const requestGeneration = generation;
  if (markFresh(best) || isHidden() || (await locationPermissionState()) !== 'granted' || requestGeneration !== generation || isHidden()) return;
  if (nativeBridge()) { nativeRequest(); return; }
  navigator.geolocation.getCurrentPosition((pos) => accept(pos, requestGeneration), () => {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}

export function startLocation() {
  if (isHidden()) return;
  emit(); // También actualiza la caducidad visible de una posición previamente guardada.
  if (nativeBridge()) {
    if (nativeTimer !== null) { if (!markFresh(best)) nativeRequest(); return; }
    nativeRequest();
    nativeTimer = setInterval(() => { if (!markFresh(best)) { emit(); nativeRequest(); } }, 20000);
    return;
  }
  if (!('geolocation' in navigator)) { emit(); return; }
  if (watchId !== null) return;
  const requestGeneration = generation;
  navigator.geolocation.getCurrentPosition((pos) => accept(pos, requestGeneration), () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  watchId = navigator.geolocation.watchPosition((pos) => accept(pos, requestGeneration), (err) => fail(err, requestGeneration), { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
}

export function stopLocation() {
  generation++;
  if (watchId !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (nativeTimer !== null) clearInterval(nativeTimer);
  nativeTimer = null;
  cancelNative();
  markWaiters.forEach((finish) => finish({ error: 'cancelled' }));
}

export function retryLocation() {
  stopLocation();
  lastError = null;
  best = null;
  emit();
  startLocation();
}

/** Espera cancelable. La edad corresponde a la captura; la API valida la precisión recibida. */
export function getLocationForMark(waitMs = 12000, { signal } = {}) {
  if (signal?.aborted || isHidden()) return Promise.resolve({ error: 'cancelled' });
  if (nativeBridge()) waitMs = Math.max(waitMs, 45000);
  else if (!('geolocation' in navigator)) return Promise.resolve({ error: 'unsupported' });
  startLocation();
  const toCoords = (fix) => ({ latitud: fix.lat.toFixed(6), longitud: fix.lon.toFixed(6), precision: Math.round(fix.accuracy), ...(typeof fix.is_mock === 'boolean' ? { mock_location: fix.is_mock } : {}) });
  if (lastError === 'denied' || lastError === 'unavailable') return Promise.resolve({ error: lastError });
  if (markFresh(best) && best.accuracy <= GOOD_ACCURACY_M) return Promise.resolve({ coords: toCoords(best) });
  return new Promise((resolve) => {
    let done = false;
    let off = null;
    let timer = null;
    let shortened = false;
    const deadline = Date.now() + waitMs;
    const finish = (explicit) => {
      if (done) return;
      done = true;
      if (off) off();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      markWaiters.delete(finish);
      resolve(explicit || (markFresh(best) ? { coords: toCoords(best) } : { error: lastError || 'timeout' }));
    };
    const abort = () => finish({ error: 'cancelled' });
    markWaiters.add(finish);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(), markFresh(best) ? Math.min(waitMs, 4000) : waitMs);
    off = onLocationChange((state) => {
      if (['denied', 'unavailable', 'unsupported'].includes(state.status)) finish({ error: state.status });
      else if (state.status === 'ready') finish();
      else if (state.status === 'imprecise' && !shortened) {
        shortened = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(), Math.min(4000, Math.max(0, deadline - Date.now())));
      }
    });
    if (done && off) off();
  });
}

export function locationErrorMessage(error) {
  const androidApp = Boolean(nativeBridge());
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  switch (error) {
    case 'denied':
      return androidApp
        ? 'La app no tiene permiso de ubicación. Actívalo en Ajustes › Apps › Asistencia › Permisos › Ubicación.'
        : ios
          ? 'Permite la ubicación para este sitio en Safari y comprueba Ajustes › Privacidad › Localización.'
          : 'Permite la ubicación para este sitio en los ajustes de tu navegador y comprueba que la ubicación del teléfono esté activada.';
    case 'unavailable': return 'No se pudo obtener tu ubicación. Comprueba que la ubicación del celular esté activada y vuelve a intentar.';
    case 'unsupported': return 'Este navegador no permite obtener la ubicación. Abre la app o un navegador compatible para marcar.';
    case 'cancelled': return '';
    default: return 'Todavía no se encuentra una ubicación reciente. Acércate a una ventana y vuelve a intentar.';
  }
}
