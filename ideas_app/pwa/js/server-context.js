// Identidad del backend: el APK conserva el mismo origen local al cambiar de servidor.
export function getServerKey() {
  let base = window.APP_API_URL || '../api/';
  try {
    const selected = window.AndroidNet?.getServer?.();
    if (selected) base = selected.replace(/\/+$/, '') + '/api/';
  } catch (_) {}
  try {
    const url = new URL(base, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin + url.pathname.replace(/\/+$/, '') + '/';
  } catch (_) { return ''; }
}

// Sólo devuelve una identidad ya vinculada mediante un inicio de sesión de esta versión.
export function getStoredContext() {
  const server = getServerKey();
  try {
    const user = JSON.parse(localStorage.getItem('asistencia_user') || 'null');
    if (user?.tipo === 'alumno') return { server, worker: '' };
    const worker = String(user?.id || user?.trabajador_id || '');
    return { server, worker: user?.server_key === server ? worker : '' };
  } catch (_) { return { server, worker: '' }; }
}

export function belongsToContext(record, context = getStoredContext()) {
  return Boolean(context.server && context.worker && record?.server_key === context.server
    && String(record.trabajador_id || record.user_id || record.owner_id || '') === context.worker);
}

// El puente nativo compara la raíz del sitio, no la URL del endpoint /api/.
export function getNativeServerBase() { return getServerKey().replace(/\/api\/$/, '/'); }
