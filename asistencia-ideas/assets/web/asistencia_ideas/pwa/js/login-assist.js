// Detección de cuenta en segundo plano: recuerda (solo en este celular) qué tipo de cuenta
// entró la última vez para preparar el login, y deja un aviso para la pantalla siguiente.
// No guarda contraseñas ni tokens: solo el usuario visible, el nombre corto y el tipo detectado.
import { getServerKey } from './server-context.js';

const LAST_KEY = 'ideas-last-account:v1';
const NOTICE_KEY = 'ideas-detected-account';

export const ACCOUNT_LABELS = {
  trabajador: 'Trabajador',
  alumno: 'Alumno',
  administracion: 'Administración',
  intranet: 'Personal de intranet'
};

const ROLE_LABELS = {
  superadmin: 'Superadministrador', admin: 'Administrador', supervisor: 'Supervisor', readonly: 'Consulta',
  administrador: 'Administrador', docente: 'Docente', secretaria: 'Secretaría'
};

export function roleLabel(rol) { return ROLE_LABELS[rol] || ''; }

// Tipo de cuenta según lo que devolvió el servidor al iniciar sesión.
export function detectedType(response) {
  if (response?.tipo === 'alumno') return 'alumno';
  if (response?.tipo === 'personal') return response.identidad?.origen === 'intranet' ? 'intranet' : 'administracion';
  return 'trabajador';
}

export function rememberLastAccount({ tipo, usuario, nombre = '', rol = '' }) {
  if (!ACCOUNT_LABELS[tipo] || !usuario) return;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({
      tipo,
      usuario: String(usuario).slice(0, 100),
      nombre: String(nombre || '').trim().split(/\s+/)[0].slice(0, 40),
      rol: String(rol || '').slice(0, 30),
      server: getServerKey(),
      at: Date.now()
    }));
  } catch (_) {}
}

// Solo vale para el servidor actual: al cambiar de servidor se detecta otra vez.
export function lastAccount() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (!value || !ACCOUNT_LABELS[value.tipo] || value.server !== getServerKey()) return null;
    return value;
  } catch (_) { return null; }
}

export function forgetLastAccount() {
  try { localStorage.removeItem(LAST_KEY); } catch (_) {}
}

// Aviso de una sola vez para la pantalla que se abre tras recargar ("Cuenta detectada: …").
export function announceDetectedAccount(tipo, rol = '') {
  const label = [ACCOUNT_LABELS[tipo], roleLabel(rol)].filter(Boolean).join(' · ');
  try { sessionStorage.setItem(NOTICE_KEY, label); } catch (_) {}
}

export function consumeDetectedAccount() {
  try {
    const value = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return value || '';
  } catch (_) { return ''; }
}

// Copia texto al portapapeles (también dentro del WebView de Android, sin permisos extra).
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (_) { return false; }
}
