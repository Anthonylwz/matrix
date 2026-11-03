// La preferencia se aplica antes del primer dibujo desde index.html.
const KEY = 'asistencia_tema';
const DURATION = 700;
const media = window.matchMedia('(prefers-color-scheme: dark)');
let appliedLook = null, revision = 0, activeTransition = null, cleanupMotion = null;
let initialized = false;
export const themeChanging = () => Boolean(cleanupMotion);

export function getThemePreference() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch { return 'auto'; }
}

export function resolvedTheme(pref = getThemePreference()) {
  return pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref;
}

export function applyTheme(pref = getThemePreference()) {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  appliedLook = resolvedTheme(pref);
  const dark = appliedLook === 'dark';
  root.style.colorScheme = appliedLook;
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    meta.removeAttribute('media');
  });
  try { window.AndroidNet?.setThemeMode?.(pref); } catch {}
  window.dispatchEvent(new CustomEvent('theme:change', { detail: { pref, dark } }));
}

function changeTheme(value) {
  const root = document.documentElement;
  const current = appliedLook || root.style.colorScheme || resolvedTheme();
  const id = ++revision;
  activeTransition?.skipTransition();
  activeTransition = null;
  cleanupMotion?.();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (current === resolvedTheme(value) || reduced || document.hidden) {
    applyTheme(value);
    return;
  }

  let timer;
  window.dispatchEvent(new Event('ideas:pausa'));
  const finish = () => {
    if (id !== revision) return;
    clearTimeout(timer);
    root.classList.remove('theme-blending', 'theme-colors');
    activeTransition = null;
    cleanupMotion = null;
    window.dispatchEvent(new Event('ideas:reanudar'));
  };
  cleanupMotion = () => {
    clearTimeout(timer);
    root.classList.remove('theme-blending', 'theme-colors');
    window.dispatchEvent(new Event('ideas:reanudar'));
    cleanupMotion = null;
  };

  if (typeof document.startViewTransition === 'function') {
    root.classList.add('theme-blending');
    try {
      const transition = document.startViewTransition(() => {
        // Al tocar varias opciones seguidas solo se aplica la ultima elegida.
        if (id === revision) applyTheme(value);
      });
      activeTransition = transition;
      transition.ready.catch(() => {});
      transition.finished.then(finish, finish);
      return;
    } catch { root.classList.remove('theme-blending'); }
  }

  // WebViews anteriores: interpolar colores, sin recargar ni mover el contenido.
  root.classList.add('theme-colors');
  void root.offsetWidth;
  applyTheme(value);
  timer = setTimeout(finish, DURATION + 80);
}

// Conserva el segundo argumento de las pantallas originales de trabajadores.
export function setThemePreference(pref, _origin = null) {
  const value = pref === 'light' || pref === 'dark' ? pref : 'auto';
  try {
    if (value === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {}
  changeTheme(value);
}

export function initTheme() {
  applyTheme();
  if (initialized) return;
  initialized = true;
  const onSystem = () => {
    if (getThemePreference() === 'auto') changeTheme('auto');
  };
  if (media.addEventListener) media.addEventListener('change', onSystem);
  else if (media.addListener) media.addListener(onSystem);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !cleanupMotion) return;
    revision++;
    activeTransition?.skipTransition();
    activeTransition = null;
    cleanupMotion();
    applyTheme();
  });
}
