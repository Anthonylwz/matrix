// Pantalla de Perfil de Usuario, Actualización de Datos y Ajustes
import { $, showToast, escapeHtml, openSheet, openFormSheet, closeSheet, dismissSheet, isSheetOpen, showActionSheet, ICON_CHEVRON, APP_VERSION, initials, enhancePasswordFields, resolveMediaUrl, playFeedback, setActiveSegment, hapticFeedback } from '../js/utils.js';
import { getUser, getToken, isLocked, clearSession, lockSession, rememberPassword, saveSession, getDeviceId, describeDevice } from '../js/auth.js';import { biometricStatus, biometricEnabled, enableBiometric, disableBiometric } from '../js/biometric.js';
import { registerPush } from '../js/push.js';
import { loginService, getProfileService, changePasswordService, uploadProfilePhotoService, sendTestPushService, setPushPreferenceService, getPushStatusService } from '../js/api.js';
import { bindWorkerContactEditors } from '../js/worker-contact.js';
import { getUnreadCount, refreshUnread } from '../js/notifications.js';
import { getThemePreference, setThemePreference, resolvedTheme } from '../js/theme.js';
import { fileToSquareJpeg, squareJpeg, startSelfieCamera, stopSelfieCamera, dataUrlToFile } from '../js/photo.js';
import { cacheUserProfile, getCachedUserProfile } from '../js/db.js';
import { isStandalone, isIOS, showIosInstallSheet } from '../js/install.js';
import { icon, rowIcon } from '../js/icons.js';
import { getServerKey } from '../js/server-context.js';

// Estado del modo Navidad: preferencia de este celular + interruptor global del administrador
function christmasState() {
  const leer = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const globalOff = leer('ideas-temporada-global') === 'off';
  const on = !globalOff && leer('ideas-temporada') !== 'off';
  const mes = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', month: 'numeric' }).format(new Date()));
  let hint;
  if (globalOff) hint = 'Desactivado por el administrador';
    else hint = on ? 'Luces en tu foto, nieve y escena navideña' : 'Sin decoraciones';
  return { on, globalOff, hint };
}

export function render(container) {
  const user = getUser() || {
    id: 0,
    nombre: 'Colaborador',
    dni: '--------',
    codigo_interno: '------',
    telefono: '',
    foto_url: null,
    turno: ''
  };

  // Dentro del APK de Android existe el puente nativo AndroidNet
  const androidApp = Boolean(window.AndroidNet && typeof window.AndroidNet.getServer === 'function');
  let androidServer = '';
  if (androidApp) {
    try { androidServer = window.AndroidNet.getServer(); } catch (_) {}
  }
  const modoEjecucion = androidApp ? 'App Android' : (isStandalone() ? 'Instalada' : (isIOS() ? 'Safari' : 'Navegador'));
  // En Android se muestra también el número de compilación del APK (para saber cuál está instalado)
  let versionTexto = APP_VERSION;
  if (androidApp && typeof window.AndroidNet.getAppInfo === 'function') {
    try { const info = JSON.parse(window.AndroidNet.getAppInfo() || '{}'); if (info.build) versionTexto = `${APP_VERSION} (${info.build})`; } catch (_) {}
  }
  const christmas = christmasState();

  container.innerHTML = `
    <div class="page">
      <!-- Cabecera de perfil -->
      <div class="profile-head">
        <button type="button" id="btn-avatar" class="avatar-edit" aria-label="Cambiar foto de perfil">
          <span id="profile-avatar-container" class="avatar avatar--initials">
            <span id="profile-initials">${escapeHtml(initials(user.nombre))}</span>
            ${user.foto_url
              ? `<img id="profile-photo" src="${escapeHtml(resolveMediaUrl(user.foto_url))}" alt="Foto de perfil" decoding="async">`
              : ''}
          </span>
          <span class="avatar-edit__ring" aria-hidden="true"></span>
          <span class="avatar-edit__badge" aria-hidden="true">${icon('camera')}</span>
        </button>
        <input type="file" id="input-photo" class="visually-hidden" accept="image/*" tabindex="-1" aria-hidden="true">
        <h2 id="profile-name" class="profile-head__name">${escapeHtml(user.nombre)}</h2>
        <p id="profile-turno" class="profile-head__sub">${escapeHtml(user.turno || 'Instituto IDEAS')}</p>
        <div class="chip-row">
          <span class="chip chip--success">${icon('check', 'chip__icon')} Activo</span>
          <span class="chip tabular">DNI ${escapeHtml(user.dni)}</span>
        </div>
      </div>

      <!-- Datos y cuenta -->
      <div class="list-header">Mis datos</div>
      <div class="ios-card ios-card--flush list-group--icons">
        <div class="list-row">
          ${rowIcon('idcard', 'blue')}
          <span class="list-row__main"><span>DNI</span></span>
          <span id="profile-dni" class="list-row__end tabular">${escapeHtml(user.dni)}</span>
        </div>
        <div class="list-row">
          ${rowIcon('hash', 'indigo')}
          <span class="list-row__main"><span>Código interno</span></span>
          <span id="profile-codigo" class="list-row__end">${escapeHtml(user.codigo_interno || 'N/A')}</span>
        </div>
        <button type="button" id="btn-open-change-phone" class="list-row">
          ${rowIcon('phone', 'green')}
          <span class="list-row__main"><span>Teléfono</span></span>
          <span class="list-row__end"><span id="profile-phone-display" class="tabular">${escapeHtml(user.telefono || 'Agregar')}</span>${ICON_CHEVRON}</span>
        </button>
        <button type="button" id="btn-open-change-email" class="list-row" aria-haspopup="dialog">
          ${rowIcon('mail', 'blue')}
          <span class="list-row__main"><span>Correo electrónico</span></span>
          <span class="list-row__end"><span id="profile-email-display" class="profile-contact-value">${escapeHtml(user.email || 'Agregar')}</span>${ICON_CHEVRON}</span>
        </button>
        <button type="button" id="btn-open-change-pass" class="list-row">
          ${rowIcon('key', 'gray')}
          <span class="list-row__main"><span>Cambiar contraseña</span></span>
          <span class="list-row__end">${ICON_CHEVRON}</span>
        </button>
      </div>

      ${biometricStatus() !== 'unsupported' ? `
      <!-- Seguridad: ingreso con huella (app Android) -->
      <div class="list-header">Seguridad</div>
      <div class="ios-card ios-card--flush list-group--icons">
        <label for="toggle-bio" class="list-row">
          ${rowIcon('fingerprint', 'green')}
          <span class="list-row__main">
            <span>Ingresar con huella</span>
            <span id="bio-hint" class="list-row__sub">Entra sin escribir tu contraseña</span>
          </span>
          <input type="checkbox" id="toggle-bio" class="ios-switch" role="switch">
        </label>
      </div>` : ''}

      <!-- Notificaciones -->
      <div class="list-header">Notificaciones</div>
      <div class="ios-card ios-card--flush list-group--icons">
        <a href="#notifications" class="list-row">
          ${rowIcon('bell', 'red')}
          <span class="list-row__main"><span>Avisos y anuncios</span></span>
          <span class="list-row__end"><span class="count-badge" data-notif-badge hidden></span>${ICON_CHEVRON}</span>
        </a>
        ${androidApp ? `
        <label for="toggle-push" class="list-row">
          ${rowIcon('bellring', 'orange')}
          <span class="list-row__main">
            <span>Notificaciones push</span>
            <span id="push-hint" class="list-row__sub">Respuestas a solicitudes y avisos</span>
          </span>
          <input type="checkbox" id="toggle-push" class="ios-switch" role="switch" checked>
        </label>
        <button type="button" id="btn-test-push" class="list-row">
          ${rowIcon('bolt', 'blue')}
          <span class="list-row__main"><span>Enviar notificación de prueba</span></span>
          <span class="list-row__end">${ICON_CHEVRON}</span>
        </button>
        <label for="toggle-reminder" class="list-row">
          ${rowIcon('timer', 'purple')}
          <span class="list-row__main">
            <span>Recordatorio de salida</span>
            <span class="list-row__sub">Aviso diario si aún no marcas tu salida</span>
          </span>
          <input type="checkbox" id="toggle-reminder" class="ios-switch" role="switch">
        </label>
        <label for="input-reminder-time" class="list-row" id="row-reminder-time" hidden>
          ${rowIcon('clock', 'gray')}
          <span class="list-row__main"><span>Hora aproximada · Lima</span></span>
          <input type="time" id="input-reminder-time" class="time-input tabular" value="18:00">
        </label>` : ''}
      </div>

      <!-- Apariencia -->
      <div class="list-header">Apariencia</div>
      <div class="ios-card theme-card">
        <div class="theme-card__head">
          ${rowIcon('moon', 'indigo')}
          <span class="list-row__main">
            <span>Tema</span>
            <span id="theme-hint" class="list-row__sub"></span>
          </span>
        </div>
        <div class="segmented" role="radiogroup" aria-label="Tema de la app">
          <button type="button" class="segmented__item" data-theme-option="auto" role="radio">Automático</button>
          <button type="button" class="segmented__item" data-theme-option="light" role="radio">${icon('sun')}<span>Claro</span></button>
          <button type="button" class="segmented__item" data-theme-option="dark" role="radio">${icon('moon')}<span>Oscuro</span></button>
        </div>
      </div>
      <div class="ios-card ios-card--flush list-group--icons section-gap">
        <label for="toggle-temporada" class="list-row">
          <span class="row-icon row-icon--green" aria-hidden="true">☃</span>
          <span class="list-row__main">
            <span>Modo Navidad</span>
            <span id="christmas-hint" class="list-row__sub">${christmas.hint}</span>
          </span>
          <input type="checkbox" id="toggle-temporada" class="ios-switch" role="switch" ${christmas.on ? 'checked' : ''} ${christmas.globalOff ? 'disabled' : ''}>
        </label>
      </div>

      <div class="ios-card ios-card--flush list-group--icons"><label class="list-row"><span class="row-icon row-icon--green" aria-hidden="true">♫</span><span class="list-row__main"><span>Música de Navidad</span><span class="list-row__sub">Sonido al entrar · En este dispositivo</span></span><input type="checkbox" class="ios-switch" role="switch" data-ideas-christmas-music checked aria-label="Música de Navidad"></label><button type="button" class="list-row" data-ideas-christmas-play><span class="list-row__main">Escuchar música navideña</span></button></div>
      <div class="list-header">Equipo</div><div class="ios-card ios-card--flush list-group--icons"><a class="list-row" href="#contacts">${rowIcon('users','orange')}<span class="list-row__main"><span>Compañeros</span><span class="list-row__sub">Buscar y abrir chat de WhatsApp</span></span><span class="list-row__end">${ICON_CHEVRON}</span></a></div>
      <!-- Aplicación -->
      <div class="list-header">Aplicación</div>
      <div class="ios-card ios-card--flush list-group--icons">
        ${androidApp ? `
        <button type="button" id="btn-server-settings" class="list-row">
          ${rowIcon('server', 'teal')}
          <span class="list-row__main">
            <span>Servidor</span>
            <span id="profile-server" class="list-row__sub">${escapeHtml(androidServer)}</span>
          </span>
          <span class="list-row__end">${ICON_CHEVRON}</span>
        </button>` : `
        <button type="button" id="btn-open-install-guide" class="list-row">
          ${rowIcon('share', 'blue')}
          <span class="list-row__main"><span>Instalar en iPhone</span></span>
          <span class="list-row__end">${ICON_CHEVRON}</span>
        </button>`}
        <button type="button" id="btn-net-test" class="list-row" aria-haspopup="dialog">
          ${rowIcon('wifi', 'blue')}
          <span class="list-row__main"><span>Probar conexión</span><span class="list-row__sub">Compara Wi-Fi y datos móviles</span></span>
          <span class="list-row__end">${ICON_CHEVRON}</span>
        </button>
        <div class="list-row">
          ${rowIcon('smartphone', 'gray')}
          <span class="list-row__main"><span>Ejecución</span></span>
          <span class="list-row__end">${modoEjecucion}</span>
        </div>
        <div class="list-row">
          ${rowIcon('info', 'gray')}
          <span class="list-row__main"><span>Versión</span></span>
          <span id="profile-app-version" class="list-row__end tabular">${versionTexto}</span>
        </div>
      </div>

      <!-- Cerrar Sesión -->
      <div class="ios-card ios-card--flush logout-area">
        <button type="button" id="btn-logout" class="list-row list-row--destructive">Cerrar sesión</button>
      </div>
    </div>

    <!-- Hoja: Actualizar Teléfono -->
    <!-- Activar huella: se confirma la contraseña (se guarda cifrada con la huella) -->
    <div id="modal-bio" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="bio-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-close-bio" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="bio-sheet-title" class="sheet__nav-title">Ingreso con huella</h3>
          <button type="submit" form="form-bio" id="btn-submit-bio" class="nav-btn nav-btn--text nav-btn--strong" disabled>Activar</button>
        </div>
        <form id="form-bio">
          <p class="sheet-hint">Escribe tu contraseña una vez. Quedará cifrada en este celular y solo se usará al poner tu huella.</p>
          <div class="ios-input-group">
            <label class="ios-label" for="input-bio-pass">Contraseña actual</label>
            <input type="password" id="input-bio-pass" class="ios-input" autocomplete="current-password" required>
          </div>
        </form>
      </div>
    </div>

    <div id="modal-phone" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="phone-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-close-phone-modal" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="phone-sheet-title" class="sheet__nav-title">Teléfono</h3>
          <button type="submit" form="form-update-phone" id="btn-submit-phone" class="nav-btn nav-btn--text nav-btn--strong" disabled>Guardar</button>
        </div>

        <form id="form-update-phone">
          <div class="ios-input-group">
            <label class="ios-label" for="input-new-phone">Nuevo número (9 dígitos)</label>
            <input type="tel" id="input-new-phone" class="ios-input" maxlength="20" pattern="[0-9]{9}" placeholder="9XXXXXXXX" autocomplete="tel-national" inputmode="numeric" required>
          </div>
        </form>
      </div>
    </div>

    <div id="modal-email" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="email-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-close-email-modal" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="email-sheet-title" class="sheet__nav-title">Correo electrónico</h3>
          <button type="submit" form="form-update-email" id="btn-submit-email" class="nav-btn nav-btn--text nav-btn--strong" disabled>Guardar</button>
        </div>
        <form id="form-update-email">
          <div class="ios-input-group">
            <label class="ios-label" for="input-new-email">Correo de contacto</label>
            <input type="email" id="input-new-email" name="email" class="ios-input" maxlength="150" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="tucorreo@ejemplo.com">
          </div>
          <p class="sheet-hint">Puedes actualizar o quitar tu correo de contacto. Seguirás ingresando con tu DNI.</p>
        </form>
      </div>
    </div>

    <!-- Hoja: Cambiar Contraseña -->
    <div id="modal-password" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="pass-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-close-pass-modal" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="pass-sheet-title" class="sheet__nav-title">Contraseña</h3>
          <button type="submit" form="form-change-password" id="btn-submit-password" class="nav-btn nav-btn--text nav-btn--strong" disabled>Guardar</button>
        </div>

        <form id="form-change-password">
          <div class="ios-input-group">
            <label class="ios-label" for="pass-current">Contraseña actual</label>
            <input type="password" id="pass-current" class="ios-input" placeholder="Tu clave actual" required autocomplete="current-password">
          </div>
          <div class="ios-input-group">
            <label class="ios-label" for="pass-new">Nueva contraseña (mínimo 6 caracteres)</label>
            <input type="password" id="pass-new" class="ios-input" placeholder="Nueva clave" required minlength="6" maxlength="72" autocomplete="new-password">
          </div>
          <div class="ios-input-group">
            <label class="ios-label" for="pass-confirm">Confirmar nueva contraseña</label>
            <input type="password" id="pass-confirm" class="ios-input" placeholder="Repite la nueva clave" required minlength="6" maxlength="72" autocomplete="new-password">
          </div>
        </form>
      </div>
    </div>

    <!-- Hoja: origen de la foto -->
    <div id="photo-source-sheet" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="photo-source-title">
        <div class="sheet__grabber"></div>
        <h3 id="photo-source-title" class="sheet__title photo-source__title">Foto de perfil</h3>
        <p class="photo-source__desc">Usa una foto donde se vea bien tu rostro.</p>
        <div class="photo-options">
          <button type="button" id="btn-photo-camera" class="photo-option">
            <span class="photo-option__icon photo-option__icon--accent">${icon('camera')}</span>
            <span class="photo-option__label">Tomar foto</span>
          </button>
          <label for="input-photo" id="btn-photo-gallery" class="photo-option" role="button" tabindex="0">
            <span class="photo-option__icon photo-option__icon--blue">${icon('image')}</span>
            <span class="photo-option__label">Elegir de la galería</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Hoja: selfie con la cámara frontal -->
    <div id="selfie-sheet" class="sheet-backdrop" hidden>
      <div class="sheet selfie-sheet" aria-labelledby="selfie-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-selfie-cancel" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="selfie-title" class="sheet__nav-title">Tomar foto</h3>
          <span></span>
        </div>
        <div class="selfie-frame">
          <video id="selfie-video" class="selfie-frame__video is-mirrored" playsinline muted autoplay></video>
          <div class="selfie-frame__ring" aria-hidden="true"></div>
          <p id="selfie-status" class="selfie-frame__status">Abriendo cámara…</p>
        </div>
        <p id="selfie-hint" class="photo-source__desc">Centra tu rostro dentro del círculo.</p>
        <div class="shutter-row">
          <label for="input-photo" class="shutter-side" role="button" tabindex="0" aria-label="Elegir de la galería">${icon('image')}</label>
          <button type="button" id="btn-selfie-shoot" class="shutter" aria-label="Tomar foto" disabled><span></span></button>
          <button type="button" id="btn-selfie-flip" class="shutter-side" aria-label="Cambiar entre cámara frontal y trasera" disabled>${icon('switchcam')}</button>
        </div>
      </div>
    </div>

    <!-- Hoja: vista previa antes de guardar -->
    <div id="photo-preview-sheet" class="sheet-backdrop" hidden>
      <div class="sheet sheet--center" aria-labelledby="photo-preview-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-photo-retake" class="nav-btn nav-btn--text">Cambiar</button>
          <h3 id="photo-preview-title" class="sheet__nav-title">Vista previa</h3>
          <span></span>
        </div>
        <div class="photo-preview">
          <img id="photo-preview-img" class="photo-preview__img" alt="Vista previa de la foto">
        </div>
        <p class="photo-source__desc">Así se verá tu foto en la app y en el panel.</p>
        <button type="button" id="btn-photo-save" class="ios-btn ios-btn-primary">
          <span id="btn-photo-save-text">Usar esta foto</span>
          <span id="btn-photo-save-spinner" class="spinner spinner--sm" hidden></span>
        </button>
      </div>
    </div>
  `;
}

export async function init() {
  const user = getUser();
  const profileServer = getServerKey();
  const isCurrentProfile = () => Boolean(user && profileServer === getServerKey() && getToken() && !isLocked() && String(user.id) === String(getUser()?.id));
  let profileRevision = 0;
  const phoneDisplay = $('#profile-phone-display');
  const emailDisplay = $('#profile-email-display');
  const modalPass = $('#modal-password');
  const btnOpenPass = $('#btn-open-change-pass');
  const btnClosePass = $('#btn-close-pass-modal');
  const formPass = $('#form-change-password');
  const logoutBtn = $('#btn-logout');
  bindWorkerContactEditors({ isCurrent: isCurrentProfile, onSaved: async fields => {
    if (!isCurrentProfile()) return;
    profileRevision++;
    const stored = { ...getUser(), ...fields };
    Object.assign(user, fields);
    localStorage.setItem('asistencia_user', JSON.stringify(stored));
    if (phoneDisplay) phoneDisplay.textContent = stored.telefono || 'Agregar';
    if (emailDisplay) emailDisplay.textContent = stored.email || 'Agregar';
    await cacheUserProfile(stored);
  } });

  // Foto de perfil sobre las iniciales; si no carga, quedan las iniciales
  function showPhoto(url) {
    const box = $('#profile-avatar-container');
    if (!box) return;
    let img = $('#profile-photo');
    if (!img) {
      img = document.createElement('img');
      img.id = 'profile-photo';
      img.alt = 'Foto de perfil';
      box.appendChild(img);
    }
    img.onerror = () => img.remove();
    const src = resolveMediaUrl(url);
    if (img.getAttribute('src') !== src) img.src = src;
  }
  const fotoInicial = $('#profile-photo');
  if (fotoInicial) {
    fotoInicial.onerror = () => fotoInicial.remove();
    if (fotoInicial.complete && fotoInicial.naturalWidth === 0) fotoInicial.remove();
  }

  // ── Foto de perfil: selfie o galería → vista previa → subir ──
  const btnAvatar = $('#btn-avatar');
  const inputPhoto = $('#input-photo');
  const sourceSheet = $('#photo-source-sheet');
  const selfieSheet = $('#selfie-sheet');
  const previewSheet = $('#photo-preview-sheet');
  const selfieVideo = $('#selfie-video');
  const selfieStatus = $('#selfie-status');
  const btnShoot = $('#btn-selfie-shoot');
  const previewImg = $('#photo-preview-img');
  const btnSave = $('#btn-photo-save');
  const btnSaveText = $('#btn-photo-save-text');
  const btnSaveSpinner = $('#btn-photo-save-spinner');
  const btnFlip = $('#btn-selfie-flip');
  const selfieHint = $('#selfie-hint');
  let selfieStream = null;
  let pendingPhoto = null;
  let uploading = false;
  let facing = 'user';
  let cameraToken = 0;

  function closeSelfie() {
    cameraToken++;
    stopSelfieCamera(selfieVideo, selfieStream);
    selfieStream = null;
    if (btnShoot) btnShoot.disabled = true;
    if (btnFlip) btnFlip.disabled = true;
  }

  function showPreview(dataUrl) {
    pendingPhoto = dataUrl;
    if (previewImg) previewImg.src = dataUrl;
    openSheet(previewSheet, { focus: btnSave, canDismiss: () => !uploading });
  }

  // Enciende la cámara elegida (frontal en espejo, trasera tal cual)
  async function startCamera() {
    const token = ++cameraToken;
    stopSelfieCamera(selfieVideo, selfieStream);
    selfieStream = null;
    if (btnShoot) btnShoot.disabled = true;
    if (selfieStatus) {
      selfieStatus.hidden = false;
      selfieStatus.textContent = 'Abriendo cámara…';
    }
    if (selfieVideo) selfieVideo.classList.toggle('is-mirrored', facing === 'user');
    if (selfieHint) {
      selfieHint.textContent = facing === 'user'
        ? 'Centra tu rostro dentro del círculo.'
        : 'Apunta a la persona y céntrala en el círculo.';
    }
    try {
      const stream = await startSelfieCamera(selfieVideo, facing);
      if (token !== cameraToken || !isSheetOpen(selfieSheet)) {
        stopSelfieCamera(null, stream);
        return;
      }
      selfieStream = stream;
      if (selfieStatus) selfieStatus.hidden = true;
      if (btnShoot) btnShoot.disabled = false;
      if (btnFlip) btnFlip.disabled = false;
    } catch (err) {
      if (token !== cameraToken) return;
      if (btnFlip) btnFlip.disabled = false;
      if (selfieStatus) {
        selfieStatus.textContent = err && err.name === 'NotAllowedError'
          ? 'Sin permiso de cámara. Elige una foto de la galería.'
          : 'No se pudo abrir esta cámara. Prueba la otra o elige de la galería.';
      }
    }
  }

  async function openSelfie() {
    await closeSheet(sourceSheet);
    openSheet(selfieSheet, { onClose: closeSelfie });
    startCamera();
  }

  if (btnFlip) {
    btnFlip.addEventListener('click', () => {
      facing = facing === 'user' ? 'environment' : 'user';
      btnFlip.classList.remove('is-spinning');
      void btnFlip.offsetWidth;
      btnFlip.classList.add('is-spinning');
      startCamera();
    });
  }

  if (btnAvatar) btnAvatar.addEventListener('click', () => openSheet(sourceSheet));
  $('#btn-photo-camera')?.addEventListener('click', openSelfie);
  $('#btn-photo-gallery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputPhoto?.click(); }
  });
  $('#btn-selfie-cancel')?.addEventListener('click', () => closeSheet(selfieSheet));

  if (btnShoot) {
    btnShoot.addEventListener('click', async () => {
      if (!selfieVideo || !selfieVideo.videoWidth) return;
      // La frontal se muestra en espejo; la foto se guarda igual que se vio
      const dataUrl = squareJpeg(selfieVideo, { mirror: facing === 'user' });
      playFeedback('success');
      await closeSheet(selfieSheet);
      closeSelfie();
      showPreview(dataUrl);
    });
  }

  if (inputPhoto) {
    inputPhoto.addEventListener('change', async () => {
      const file = inputPhoto.files && inputPhoto.files[0];
      inputPhoto.value = '';
      if (!file) return;
      closeSheet(sourceSheet);
      if (isSheetOpen(selfieSheet)) await closeSheet(selfieSheet);
      try {
        showPreview(await fileToSquareJpeg(file));
      } catch (err) {
        showToast(err && err.message === 'La imagen es demasiado grande'
          ? 'La imagen es demasiado grande. Elige otra.'
          : 'No se pudo leer esa imagen. Prueba con otra.', 'danger');
      }
    });
  }

  // App Android: la galería entrega la foto ya decodificada (HEIC incluido) por el puente nativo
  async function takeAndroidPhoto() {
    let dataUrl = '';
    try { dataUrl = window.AndroidNet.takePendingPhoto(); } catch (_) {}
    if (btnAvatar && !uploading) btnAvatar.classList.remove('is-uploading');
    if (!dataUrl) return;
    if (dataUrl === 'error') {
      showToast('No se pudo leer esa imagen. Prueba con otra.', 'danger');
      return;
    }
    if (isSheetOpen(sourceSheet)) closeSheet(sourceSheet);
    if (isSheetOpen(selfieSheet)) await closeSheet(selfieSheet);
    try {
      showPreview(await fileToSquareJpeg(await dataUrlToFile(dataUrl)));
    } catch (_) {
      showToast('No se pudo leer esa imagen. Prueba con otra.', 'danger');
    }
  }

  const onAndroidPhoto = (e) => {
    if (e.detail === 'loading') {
      if (btnAvatar) btnAvatar.classList.add('is-uploading');
      if (isSheetOpen(sourceSheet)) closeSheet(sourceSheet);
      if (isSheetOpen(selfieSheet)) closeSheet(selfieSheet);
      return;
    }
    takeAndroidPhoto();
  };
  const androidPhotos = Boolean(window.AndroidNet && typeof window.AndroidNet.takePendingPhoto === 'function');
  if (androidPhotos) {
    window.addEventListener('android:photo', onAndroidPhoto);
    window.addEventListener('hashchange', () => window.removeEventListener('android:photo', onAndroidPhoto), { once: true });
    // Llegó mientras la página se volvía a cargar
    try { if (window.AndroidNet.hasPendingPhoto()) takeAndroidPhoto(); } catch (_) {}
  }

  $('#btn-photo-retake')?.addEventListener('click', async () => {
    if (uploading) return;
    await closeSheet(previewSheet);
    openSheet(sourceSheet);
  });

  function setUploading(on) {
    uploading = on;
    if (btnSave) btnSave.disabled = on;
    if (btnSaveText) btnSaveText.hidden = on;
    if (btnSaveSpinner) btnSaveSpinner.hidden = !on;
    if (btnAvatar) btnAvatar.classList.toggle('is-uploading', on);
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (!pendingPhoto || uploading) return;
      setUploading(true);
      try {
        const res = await uploadProfilePhotoService(pendingPhoto);
        if (res.cancelled || !isCurrentProfile()) { setUploading(false); return; }
        if (res.success && res.data && res.data.foto_url) {
          profileRevision++;
          // Se muestra al instante la versión local; la del servidor queda guardada para la próxima vez
          showPhoto(pendingPhoto);
          const stored = { ...(getUser() || {}), foto_url: res.data.foto_url };
          localStorage.setItem('asistencia_user', JSON.stringify(stored));
          cacheUserProfile(stored).catch(() => {});
          // La pestaña Perfil muestra la foto nueva (versión local, al instante)
          window.dispatchEvent(new CustomEvent('user:photo', { detail: { src: pendingPhoto } }));
          setUploading(false);
          await closeSheet(previewSheet);
          if (btnAvatar) {
            btnAvatar.classList.remove('is-updated');
            void btnAvatar.offsetWidth;
            btnAvatar.classList.add('is-updated');
          }
          playFeedback('success');
          showToast('Foto de perfil actualizada', 'success');
          pendingPhoto = null;
        } else {
          setUploading(false);
          showToast(res.offline ? 'Sin conexión. Inténtalo cuando tengas Internet.' : (res.message || 'No se pudo subir la foto'), 'danger');
        }
      } catch (_) {
        setUploading(false);
        showToast('Error de conexión con el servidor', 'danger');
      }
    });
  }

  // Al salir de Perfil o minimizar la app con la selfie abierta, la cámara se apaga
  const onHidden = () => { if (document.hidden && isSheetOpen(selfieSheet)) closeSheet(selfieSheet); };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('hashchange', () => {
    closeSelfie();
    document.removeEventListener('visibilitychange', onHidden);
  }, { once: true });

  // Ojo para ver lo que se escribe en las contraseñas
  if (formPass) enhancePasswordFields(formPass);

  // Modo Navidad: preferencia de este celular (el administrador también puede apagarlo para todos)
  // ── Ingreso con huella ──
  const toggleBio = $('#toggle-bio');
  const bioHint = $('#bio-hint');
  const modalBio = $('#modal-bio');
  const formBio = $('#form-bio');
  const inputBioPass = $('#input-bio-pass');
  const btnSubmitBio = $('#btn-submit-bio');
  const paintBio = () => {
    if (!toggleBio) return;
    const st = biometricStatus();
    toggleBio.checked = biometricEnabled();
    toggleBio.disabled = st !== 'available' && !toggleBio.checked;
    if (bioHint) {
      bioHint.textContent = st === 'none_enrolled' ? 'Primero registra una huella en los ajustes del celular'
        : st === 'no_hardware' ? 'Este celular no tiene lector de huella'
        : toggleBio.checked ? 'Activado · entra con tu huella' : 'Entra sin escribir tu contraseña';
    }
  };
  paintBio();
  if (toggleBio) {
    toggleBio.addEventListener('change', async () => {
      if (!toggleBio.checked) {
        disableBiometric();
        paintBio();
        showToast('Ingreso con huella desactivado', 'info');
        return;
      }
      toggleBio.checked = false; // se marca solo si se completa la activación
      if (inputBioPass) inputBioPass.value = '';
      if (btnSubmitBio) btnSubmitBio.disabled = true;
      openFormSheet(modalBio, formBio, { onClose: () => { if (inputBioPass) inputBioPass.value = ''; } });
    });
  }
  $('#btn-close-bio')?.addEventListener('click', () => dismissSheet(modalBio));
  inputBioPass?.addEventListener('input', () => { if (btnSubmitBio) btnSubmitBio.disabled = !inputBioPass.value; });
  formBio?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getUser() || {};
    const bioServer = getServerKey();
    const bioDni = String(user.dni || '');
    const bioWorker = String(user.id || '');
    const sameBioContext = () => getServerKey() === bioServer && String(getUser()?.id || '') === bioWorker && String(getUser()?.dni || '') === bioDni;
    const pass = inputBioPass ? inputBioPass.value : '';
    if (!pass || !bioDni) return;
    btnSubmitBio.disabled = true;
    // Se comprueba la contraseña con el servidor antes de guardarla
    const res = await loginService(bioDni, pass, { deviceToken: getDeviceId(), ...describeDevice() });
    if (res.cancelled || !sameBioContext()) { if (inputBioPass) inputBioPass.value = ''; btnSubmitBio.disabled = false; return; }
    if (!res.success || !res.data || !res.data.token_sesion) {
      btnSubmitBio.disabled = false;
      showToast(res.offline ? 'Necesitas conexión para activar la huella' : 'Contraseña incorrecta', 'danger');
      return;
    }
    await saveSession(res.data, res.data.token_sesion);
    if (!sameBioContext()) { if (inputBioPass) inputBioPass.value = ''; return; }
    closeSheet(modalBio);
    const ok = await enableBiometric(bioDni, pass, { serverKey: bioServer });
    if (inputBioPass) inputBioPass.value = '';
    if (!sameBioContext()) return;
    paintBio();
    showToast(ok ? 'Listo: la próxima vez entra con tu huella' : 'No se activó la huella', ok ? 'success' : 'info');
  });

  // ── Tema: Automático / Claro / Oscuro ──
  const themeButtons = Array.from(document.querySelectorAll('.view:not(.view--leaving) [data-theme-option]'));
  const themeHint = $('#theme-hint');
  const paintTheme = () => {
    const pref = getThemePreference();
    const active = themeButtons.find((b) => b.dataset.themeOption === pref);
    if (active) setActiveSegment(themeButtons, active);
    themeButtons.forEach((b) => b.setAttribute('aria-checked', b.dataset.themeOption === pref ? 'true' : 'false'));
    if (themeHint) {
      themeHint.textContent = pref === 'auto'
        ? `Igual que el celular · ahora ${resolvedTheme() === 'dark' ? 'oscuro' : 'claro'}`
        : (pref === 'dark' ? 'Siempre oscuro' : 'Siempre claro');
    }
  };
  themeButtons.forEach((btn) => btn.addEventListener('click', (e) => {
    const r = btn.getBoundingClientRect();
    const origin = e && e.clientX ? { x: e.clientX, y: e.clientY } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setThemePreference(btn.dataset.themeOption, origin);
    hapticFeedback([8]);
  }));
  const onThemeChange = () => paintTheme();
  window.addEventListener('theme:change', onThemeChange);
  window.addEventListener('hashchange', () => window.removeEventListener('theme:change', onThemeChange), { once: true });
  paintTheme();

  // ── Notificaciones ──
  const unreadBadge = document.querySelector('.view:not(.view--leaving) [data-notif-badge]');
  if (unreadBadge) { const n = getUnreadCount(); unreadBadge.textContent = String(n); unreadBadge.hidden = !n; }
  refreshUnread();

  const togglePush = $('#toggle-push');
  const pushHint = $('#push-hint');
  if (togglePush) {
    const sistemaPermite = () => { try { return window.AndroidNet.notificationsAllowed(); } catch (_) { return true; } };
    const pintarHint = (txt) => { if (pushHint) pushHint.textContent = txt; };
    if (!sistemaPermite()) pintarHint('Desactivadas en Android · toca para activarlas');
    togglePush.disabled = true;
    getPushStatusService().then((res) => {
      if (!isCurrentProfile() || res?.cancelled) return;
      if (res && res.success && res.data) {
        togglePush.checked = Boolean(res.data.habilitadas);
        togglePush.disabled = false;
        if (!sistemaPermite()) pintarHint('Desactivadas en Android · toca para activarlas');
        else if (res.data.servidor_configurado === false) pintarHint('El servidor aún no tiene Firebase configurado');
        else pintarHint(togglePush.checked ? 'Respuestas a solicitudes y avisos' : 'Desactivadas en este dispositivo');
      } else {
        pintarHint('Conéctate para consultar y cambiar tus alertas');
      }
    }).catch(() => pintarHint('Conéctate para consultar y cambiar tus alertas'));
    togglePush.addEventListener('change', async () => {
      const on = togglePush.checked;
      togglePush.disabled = true;
      if (on && !sistemaPermite()) {
        try { window.AndroidNet.requestNotificationPermission(); window.AndroidNet.openNotificationSettings(); } catch (_) {}
      }
      try {
        const res = await setPushPreferenceService(on);
        if (res?.cancelled || !isCurrentProfile()) return;
        if (!res || !res.success) {
          togglePush.checked = !on;
          showToast(res?.message || 'No se pudo cambiar la preferencia', 'danger');
        } else {
          await registerPush();
          if (!isCurrentProfile()) return;
          const granted = sistemaPermite();
          pintarHint(!on ? 'Desactivadas en este dispositivo' : granted ? 'Respuestas a solicitudes y avisos' : 'Permite las notificaciones en los ajustes de Android');
          showToast(!on ? 'Notificaciones desactivadas' : granted ? 'Notificaciones activadas' : 'Preferencia guardada. Falta permitir las notificaciones en Android.', granted || !on ? 'success' : 'info');
        }
      } catch (_) {
        if (isCurrentProfile()) { togglePush.checked = !on; showToast('No se pudo cambiar la preferencia', 'danger'); }
      } finally {
        if (isCurrentProfile()) togglePush.disabled = false;
      }
    });
  }

  const btnTestPush = $('#btn-test-push');
  if (btnTestPush) {
    btnTestPush.addEventListener('click', async () => {
      btnTestPush.disabled = true;
      const label = btnTestPush.querySelector('.list-row__main span');
      const original = label ? label.textContent : '';
      if (label) label.textContent = 'Enviando…';
      const res = await sendTestPushService();
      if (label) label.textContent = original;
      btnTestPush.disabled = false;
      if (res && res.success) showToast('Notificación de prueba enviada. Debe llegar en unos segundos.', 'success');
      else showToast(res?.message || 'No se pudo enviar la prueba', 'danger');
    });
  }

  const toggleReminder = $('#toggle-reminder');
  const rowReminderTime = $('#row-reminder-time');
  const inputReminderTime = $('#input-reminder-time');
  if (toggleReminder && window.AndroidNet?.getExitReminder) {
    try {
      const cfg = JSON.parse(window.AndroidNet.getExitReminder() || '{}');
      toggleReminder.checked = Boolean(cfg.enabled);
      if (inputReminderTime && cfg.time) inputReminderTime.value = cfg.time;
    } catch (_) {}
    if (rowReminderTime) rowReminderTime.hidden = !toggleReminder.checked;
    const guardar = () => {
      try { window.AndroidNet.setExitReminder(toggleReminder.checked, inputReminderTime ? inputReminderTime.value : '18:00'); } catch (_) {}
    };
    toggleReminder.addEventListener('change', () => {
      if (rowReminderTime) rowReminderTime.hidden = !toggleReminder.checked;
      guardar();
      showToast(toggleReminder.checked ? `Recordatorio alrededor de las ${inputReminderTime?.value || '18:00'} (hora de Lima)` : 'Recordatorio desactivado', 'success');
    });
    inputReminderTime?.addEventListener('change', guardar);
  }

  const toggleTemporada = $('#toggle-temporada');
  const christmasHint = $('#christmas-hint');
  if (toggleTemporada) {
    toggleTemporada.addEventListener('change', () => {
      try { localStorage.setItem('ideas-temporada', toggleTemporada.checked ? 'on' : 'off'); } catch (_) {}
      window.dispatchEvent(new Event('ideas:temporada'));
      if (christmasHint) christmasHint.textContent = christmasState().hint;
      showToast(toggleTemporada.checked ? 'Modo Navidad activado ☃' : 'Modo Navidad desactivado', 'info', 2200);
    });
  }

  // Cargar datos frescos de la API get_perfil.php
  async function refreshProfile() {
    if (!user || !user.id) return;
    const revision = profileRevision;
    try {
      const res = await getProfileService();
      if (res.cancelled || !isCurrentProfile() || revision !== profileRevision) return;
      if (res.success && res.data) {
        const d = res.data;
        if (phoneDisplay) phoneDisplay.textContent = d.telefono || 'Agregar';
        if (emailDisplay) emailDisplay.textContent = d.email || 'Agregar';
        Object.assign(user, { telefono: d.telefono, email: d.email });
        const nameEl = $('#profile-name');
        if (nameEl && d.nombre) nameEl.textContent = d.nombre;
        const initialsEl = $('#profile-initials');
        if (initialsEl && d.nombre) initialsEl.textContent = initials(d.nombre);
        if (d.foto_url) showPhoto(d.foto_url);
        else $('#profile-photo')?.remove();
        // Foto cambiada desde el panel: se guarda y se actualiza la pestaña Perfil
        const actual = getUser() || {};
        if ((d.foto_url || null) !== (actual.foto_url || null)) {
          try { localStorage.setItem('asistencia_user', JSON.stringify({ ...actual, foto_url: d.foto_url || null })); } catch (_) {}
          window.dispatchEvent(new CustomEvent('user:photo'));
        }
        const dniEl = $('#profile-dni');
        if (dniEl && d.dni) dniEl.textContent = d.dni;
        const codEl = $('#profile-codigo');
        if (codEl && d.codigo_interno) codEl.textContent = d.codigo_interno;
        const turnoEl = $('#profile-turno');
        if (turnoEl && d.turno) turnoEl.textContent = d.turno;

        // Actualizar en almacenamiento
        const updatedUser = { ...(getUser() || user), ...d };
        localStorage.setItem('asistencia_user', JSON.stringify(updatedUser));
        await cacheUserProfile(updatedUser);
      }
    } catch (_) {
      // Si falla la red, cargar desde IndexedDB
      const cached = await getCachedUserProfile(user.id);
      if (cached && isCurrentProfile() && revision === profileRevision) {
        if (phoneDisplay) phoneDisplay.textContent = cached.telefono || 'Agregar';
        if (emailDisplay) emailDisplay.textContent = cached.email || 'Agregar';
      }
    }
  }
  refreshProfile();

  // Hoja de Contraseña
  const submitPass = $('#btn-submit-password');
  const updatePassState = () => {
    const filled = ['#pass-current', '#pass-new', '#pass-confirm'].every((id) => ($(id)?.value || '').length > 0);
    if (submitPass) submitPass.disabled = !filled;
  };
  formPass?.addEventListener('input', updatePassState);

  if (btnOpenPass && modalPass && formPass) {
    btnOpenPass.addEventListener('click', () => {
      openFormSheet(modalPass, formPass, { onClose: updatePassState });
    });
  }
  if (btnClosePass) btnClosePass.addEventListener('click', () => dismissSheet(modalPass));

  // Envío del cambio de contraseña
  if (formPass) {
    formPass.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pActual = $('#pass-current')?.value || '';
      const pNueva = $('#pass-new')?.value || '';
      const pConfirm = $('#pass-confirm')?.value || '';

      if (pNueva.length < 6) {
        showToast('La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
        return;
      }
      if (pNueva !== pConfirm) {
        showToast('Las contraseñas no coinciden.', 'warning');
        return;
      }
      if (pActual === pNueva) {
        showToast('La nueva contraseña debe ser distinta a la actual.', 'warning');
        return;
      }

      if (submitPass) {
        submitPass.disabled = true;
        submitPass.textContent = 'Guardando…';
      }

      const passwordServer = getServerKey();
      const passwordUser = getUser() || {};
      const passwordDni = String(passwordUser.dni || '');
      const passwordWorker = String(passwordUser.id || '');
      const samePasswordContext = () => getServerKey() === passwordServer && String(getUser()?.id || '') === passwordWorker && String(getUser()?.dni || '') === passwordDni;
      try {
        const res = await changePasswordService(pActual, pNueva);
        if (res.cancelled || !samePasswordContext()) return;
        if (res.success) {
          showToast('Contraseña actualizada correctamente', 'success');
          closeSheet(modalPass); // al cerrarse reinicia el formulario
          // Sin Internet se entrará con la contraseña nueva (la anterior deja de servir)
          try { await rememberPassword(passwordUser, pNueva); } catch (_) {}
          // La huella guardaba la contraseña anterior: se actualiza con la nueva (pide la huella)
          if (biometricEnabled()) {
            const ok = passwordDni ? await enableBiometric(passwordDni, pNueva, { serverKey: passwordServer }) : false;
            if (!samePasswordContext()) return;
            if (!ok) { disableBiometric(); showToast('Vuelve a activar el ingreso con huella en Perfil', 'info'); }
            paintBio();
          }
        } else {
          showToast(res.message || 'Contraseña actual incorrecta', 'danger');
        }
      } catch (_) {
        showToast('Error de conexión con el servidor', 'danger');
      } finally {
        if (submitPass) submitPass.textContent = 'Guardar';
        updatePassState();
      }
    });
  }

  // Cierre de sesión con action sheet
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const choice = await showActionSheet({
        title: '¿Cerrar sesión?',
        message: 'Podrás volver a entrar con tu contraseña o tu huella, incluso sin Internet. Las marcaciones pendientes se conservan.',
        actions: [{ label: 'Cerrar sesión', value: 'logout', style: 'destructive' }]
      });
      if (choice === 'logout') {
        lockSession();
        window.location.hash = '#login';
      }
    });
  }

  // Dirección del servidor (solo en la app Android)
  const btnServer = $('#btn-server-settings');
  if (btnServer) {
    btnServer.addEventListener('click', () => {
      try { window.AndroidNet.openServerSettings(); } catch (_) {}
    });
  }

  // Prueba de conexión con el servidor (se carga al abrirla)
  $('#btn-net-test')?.addEventListener('click', () => {
    import('../js/connection-test.js').then((m) => m.openConnectionTest()).catch(() => showToast('No se pudo abrir la prueba de conexión.', 'warning'));
  });

  // Guía de instalación en iPhone
  const btnInstallGuide = $('#btn-open-install-guide');
  if (btnInstallGuide) {
    btnInstallGuide.addEventListener('click', () => {
      showIosInstallSheet(true);
    });
  }
}
