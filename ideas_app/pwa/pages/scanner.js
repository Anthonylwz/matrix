// Pantalla de Escáner QR (cámara a pantalla completa) y Código Manual
import { $, formatTime, openSheet, closeSheet, isSheetOpen, setActiveSegment, playFeedback, hapticFeedback, showToast } from '../js/utils.js';
import { startLocation, stopLocation, retryLocation, onLocationChange, getLocationState, locationErrorMessage, usesNativeLocation, locationPermissionState } from '../js/location.js';
import { QRScannerController } from '../js/scanner.js';
import { icon } from '../js/icons.js';
import { marcarAsistenciaService, getJornadaService } from '../js/api.js';
import { verifySignedQR } from '../js/security.js';
import { getRouteParams, getReturnRoute } from '../js/router.js';

// pathLength="1" permite dibujar el trazo con una sola animación de dash
const ICON_RESULT = {
  success: '<polyline pathLength="1" points="20 6 9 17 4 12"></polyline>',
  warning: '<circle pathLength="1" cx="12" cy="12" r="9.5"></circle><polyline pathLength="1" points="12 7 12 12 15.5 14"></polyline>',
  danger: '<line pathLength="1" x1="17" y1="7" x2="7" y2="17"></line><line pathLength="1" x1="7" y1="7" x2="17" y2="17"></line>'
};

const HINT_CAMERA = 'Apunta al código QR de la pantalla de asistencia';
const HINT_SLOW = 'Acerca el celular a la pantalla y evita reflejos';
const HINT_SLOW_AFTER_MS = 8000;

// Qué toca marcar, en palabras del trabajador
const NEXT_ACTION = {
  entrada: 'Marcar entrada',
  almuerzo: 'Salir a almorzar',
  regreso_almuerzo: 'Volver del almuerzo',
  salida: 'Marcar salida',
  salida_temporal: 'Salida temporal',
  retorno_temporal: 'Retorno temporal'
};

const TIPO_CHIPS = [
  { value: 'auto', label: 'Automático' },
  { value: 'entrada', label: 'Entrada' },
  { value: 'almuerzo', label: 'Almuerzo' },
  { value: 'regreso_almuerzo', label: 'Retorno' },
  { value: 'salida', label: 'Salida' }
];

export function render(container) {
  container.innerHTML = `
    <div id="scan-screen" class="scan-screen is-starting" data-mode="camera">
      <!-- Cámara QR (rehecha: marco fijo, estado de ubicación y mensajes en un solo lugar) -->
      <div id="scanner-camera-view" class="qrcam">
        <video id="qr-video" class="qrcam__video" playsinline muted autoplay></video>
        <div class="qrcam__shade" aria-hidden="true"></div>

        <div class="qrcam__stage">
          <!-- Estado de la ubicación: el servidor exige el GPS para aceptar la marcación -->
          <button type="button" id="qrcam-gps" class="qrcam-chip" data-state="searching">
            <span class="qrcam-chip__dot" aria-hidden="true"></span>
            <span id="qrcam-gps-text" aria-live="polite" aria-atomic="true">Buscando tu ubicación…</span>
          </button>

          <div id="qr-guide-box" class="qrcam__frame" aria-hidden="true">
            <i class="qrcam__corner qrcam__corner--tl"></i>
            <i class="qrcam__corner qrcam__corner--tr"></i>
            <i class="qrcam__corner qrcam__corner--bl"></i>
            <i class="qrcam__corner qrcam__corner--br"></i>
            <i class="qrcam__sweep"></i>
            <span class="qrcam__badge qrcam__badge--ok">${icon('check')}</span>
            <span class="qrcam__badge qrcam__badge--busy"><span class="spinner spinner--light"></span></span>
          </div>

          <p id="scan-hint" class="qrcam__msg" aria-live="polite">${HINT_CAMERA}</p>
          <button type="button" id="btn-slow-manual" class="qrcam-link" hidden>
            ${icon('keypad')}<span>Usar el código de 6 dígitos</span>
          </button>
        </div>

        <!-- Encendiendo la cámara -->
        <div class="qrcam__loading" aria-hidden="true">
          <span class="spinner spinner--light"></span>
          <span>Iniciando cámara…</span>
        </div>

        <!-- Sin cámara o sin permiso -->
        <div id="camera-fallback-msg" class="qrcam__error" hidden>
          <span class="qrcam__error-icon">${icon('camera')}</span>
          <h3 id="camera-error-title" class="qrcam__error-title">Cámara no disponible</h3>
          <p id="camera-error-text" class="qrcam__error-text">No se pudo iniciar la cámara.</p>
          <div class="qrcam__error-actions">
            <button type="button" id="btn-retry-camera" class="ios-btn ios-btn-primary">
              ${icon('camera')}<span id="btn-retry-camera-text">Permitir cámara</span>
            </button>
            <button type="button" id="btn-open-camera-settings" class="ios-btn qrcam-glass" hidden>
              ${icon('server')}<span>Abrir ajustes</span>
            </button>
            <button type="button" id="btn-use-code-from-error" class="ios-btn qrcam-glass">
              ${icon('keypad')}<span>Usar código de 6 dígitos</span>
            </button>
          </div>
        </div>
      </div>
      <!-- Código manual -->
      <div id="scanner-manual-view" class="scan-manual" hidden>
        <button type="button" id="manual-gps" class="manual-location" data-state="searching">
          <span aria-hidden="true">${icon('mappin')}</span>
          <span id="manual-gps-text" aria-live="polite" aria-atomic="true">Buscando tu ubicación…</span>
          <span aria-hidden="true">${icon('chevron')}</span>
        </button>
        <div class="ios-card manual-card">
          <span class="manual-card__icon">${icon('keypad')}</span>
          <h3 class="manual-card__title">Código temporal</h3>
          <p class="manual-card__desc">Escribe los 6 dígitos que aparecen en la pantalla de asistencia.</p>

          <form id="manual-code-form" novalidate>
            <!-- Seis casillas visuales; el campo real queda encima, invisible, para el teclado y el autocompletado -->
            <div class="otp" id="otp">
              <div class="otp__boxes" aria-hidden="true">
                <span class="otp__box"></span><span class="otp__box"></span><span class="otp__box"></span>
                <span class="otp__sep"></span>
                <span class="otp__box"></span><span class="otp__box"></span><span class="otp__box"></span>
              </div>
              <input
                type="tel"
                id="input-manual-code"
                class="otp__input"
                pattern="[0-9]{6}"
                inputmode="numeric"
                autocomplete="one-time-code"
                aria-label="Código de 6 dígitos"
                aria-describedby="otp-msg"
                required
              >
            </div>

            <div class="otp-tools">
              <p id="otp-msg" class="otp-msg" aria-live="polite">Se envía al completar el código</p>
              <button type="button" id="btn-paste-code" class="text-btn paste-chip" hidden>${icon('clipboard')}<span id="paste-code-label">Pegar</span></button>
            </div>

            <fieldset class="tipo-picker">
              <legend class="tipo-picker__label">¿Qué vas a marcar?</legend>
              <div class="tipo-chips" role="radiogroup">
                ${TIPO_CHIPS.map((c, i) => `
                  <label class="tipo-chip">
                    <input type="radio" name="tipo" value="${c.value}" ${i === 0 ? 'checked' : ''}>
                    <span>${c.label}</span>
                  </label>`).join('')}
              </div>
              <p id="tipo-auto-note" class="tipo-picker__note">El sistema elige según tu jornada.</p>
            </fieldset>

            <button type="submit" id="btn-submit-manual-code" class="ios-btn ios-btn-primary" disabled>
              <span id="btn-code-text">Registrar marcación</span>
              <span id="btn-code-spinner" class="spinner spinner--sm" hidden></span>
            </button>
          </form>
        </div>
      </div>

      <!-- Controles flotantes superiores -->
      <div class="scan-top">
        <button type="button" class="scan-fab" data-nav-close aria-label="Cerrar">
          ${icon('close')}
        </button>
        <div class="scan-top__center">
          <div class="scan-title">Marcar asistencia</div>
          <div id="scan-status" class="scan-status" hidden>
            <span class="scan-status__dot"></span>
            <span id="scan-status-text"></span>
          </div>
        </div>
        <div class="scan-top__actions">
          <button type="button" id="btn-torch" class="scan-fab scan-fab--camera" aria-label="Linterna" aria-pressed="false" hidden>
            ${icon('flashlight')}
          </button>
          <button type="button" id="btn-switch-cam" class="scan-fab scan-fab--camera" aria-label="Cambiar cámara">
            ${icon('switchcam')}
          </button>
        </div>
      </div>

      <!-- Controles flotantes inferiores -->
      <div class="scan-bottom">
        <button type="button" id="btn-zoom" class="scan-zoom" aria-label="Zoom" hidden>1×</button>
        <div class="segmented segmented--floating" role="tablist" aria-label="Método de marcación">
          <button type="button" id="tab-scan-camera" class="segmented__item is-active" role="tab" aria-controls="scanner-camera-view" aria-selected="true">${icon('scan')}<span>Cámara QR</span></button>
          <button type="button" id="tab-scan-manual" class="segmented__item" role="tab" aria-controls="scanner-manual-view" aria-selected="false">${icon('keypad')}<span>Código</span></button>
        </div>
      </div>
    </div>

    <!-- Antes de pedir la ubicación: para qué se usa (y, si está bloqueada, cómo activarla) -->
    <div id="loc-primer" class="sheet-backdrop" hidden>
      <div class="sheet sheet--center loc-primer" aria-labelledby="loc-primer-title">
        <div class="sheet__grabber"></div>
        <span class="loc-primer__icon">${icon('mappin')}</span>
        <h3 id="loc-primer-title" class="result-title">Confirma que estás en la sede</h3>
        <p id="loc-primer-text" class="result-message">Para confirmar que estás en la sede buscamos tu ubicación mientras marcas. Al cerrar o dejar esta pantalla se detiene la búsqueda.</p>
        <div class="btn-row">
          <button type="button" id="btn-loc-allow" class="ios-btn ios-btn-primary">Permitir ubicación</button>
          <button type="button" id="btn-loc-later" class="ios-btn ios-btn-secondary">Ahora no</button>
        </div>
      </div>
    </div>

    <!-- Hoja de Resultado de Marcación -->
    <div id="result-sheet-modal" class="sheet-backdrop" data-dismissible="false" hidden>
      <div class="sheet sheet--center" aria-labelledby="result-title">
        <div class="sheet__grabber"></div>
        <div id="result-icon-container" class="result-icon">
          <svg id="result-icon-svg" viewBox="0 0 24 24" aria-hidden="true"></svg>
        </div>

        <h3 id="result-title" class="result-title">¡Marcación registrada!</h3>
        <p id="result-message" class="result-message">Detalle de la marcación</p>

        <div id="result-details-card" class="inset-panel result-details" hidden>
          <div class="kv-row">
            <span class="kv-row__label">Tipo</span>
            <span id="detail-tipo" class="kv-row__value">-</span>
          </div>
          <div class="kv-row">
            <span class="kv-row__label">Hora</span>
            <span id="detail-hora" class="kv-row__value tabular">-</span>
          </div>
          <div class="kv-row">
            <span class="kv-row__label">Método</span>
            <span id="detail-metodo" class="kv-row__value">-</span>
          </div>
          <div class="kv-row">
            <span class="kv-row__label">Estado</span>
            <span id="detail-estado" class="ios-badge badge-success">-</span>
          </div>
        </div>

        <div class="btn-row">
          <button type="button" id="btn-accept-result" class="ios-btn ios-btn-primary">Aceptar</button>
          <button type="button" id="btn-scan-again" class="ios-btn ios-btn-secondary" hidden>Escanear de nuevo</button>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  let scannerInstance = null;
  let left = false;
  let isProcessing = false;
  let cameraStarting = false;
  let markController = null;
  let actionGeneration = 0;
  let interruptedMark = false;
  let deferredResult = null;
  const screen = $('#scan-screen');
  const tabCamera = $('#tab-scan-camera');
  const tabManual = $('#tab-scan-manual');
  const viewCamera = $('#scanner-camera-view');
  const viewManual = $('#scanner-manual-view');
  const videoEl = $('#qr-video');
  const guide = $('#qr-guide-box');
  const hint = $('#scan-hint');
  const statusBox = $('#scan-status');
  const statusText = $('#scan-status-text');
  const fallbackBox = $('#camera-fallback-msg');
  const fallbackText = $('#camera-error-text');
  const btnFromError = $('#btn-use-code-from-error');
  const btnRetryCamera = $('#btn-retry-camera');
  const btnSwitchCam = $('#btn-switch-cam');
  const btnTorch = $('#btn-torch');
  const btnZoom = $('#btn-zoom');
  const manualForm = $('#manual-code-form');
  const manualInput = $('#input-manual-code');
  const otp = $('#otp');
  const otpMsg = $('#otp-msg');
  const btnPaste = $('#btn-paste-code');
  const tipoNote = $('#tipo-auto-note');
  const btnCodeText = $('#btn-code-text');
  const btnCodeSpinner = $('#btn-code-spinner');
  const btnSubmitCode = $('#btn-submit-manual-code');

  // Hoja de resultado
  const resultModal = $('#result-sheet-modal');
  const resultIconBox = $('#result-icon-container');
  const resultIconSvg = $('#result-icon-svg');
  const resultTitle = $('#result-title');
  const resultMsg = $('#result-message');
  const resultDetails = $('#result-details-card');
  const detailTipo = $('#detail-tipo');
  const detailHora = $('#detail-hora');
  const detailMetodo = $('#detail-metodo');
  const detailEstado = $('#detail-estado');
  const btnAcceptResult = $('#btn-accept-result');
  const btnScanAgain = $('#btn-scan-again');

  const startManual = getRouteParams().has('manual');

  // ── Ubicación: se empieza a buscar al abrir la pantalla (QR y código la necesitan) ──
  const gpsChip = $('#qrcam-gps');
  const gpsText = $('#qrcam-gps-text');
  const manualGps = $('#manual-gps');
  const manualGpsText = $('#manual-gps-text');
  function updateLocationDisplay(status, text) {
    for (const [button, label] of [[gpsChip, gpsText], [manualGps, manualGpsText]]) {
      if (button) button.dataset.state = status;
      if (label && label.textContent !== text) label.textContent = text;
    }
  }
  let gpsState = getLocationState();
  let gpsPermission = 'granted';
  const locPrimer = $('#loc-primer');
  // Antes de que salte el aviso del sistema, se explica para qué se usa la ubicación
  function showLocationPrimer(state) {
    if (!locPrimer || isSheetOpen(locPrimer)) return;
    const bloqueada = state === 'denied';
    const title = $('#loc-primer-title');
    const text = $('#loc-primer-text');
    const allow = $('#btn-loc-allow');
    const android = Boolean(window.AndroidNet && typeof window.AndroidNet.openAppSettings === 'function');
    if (title) title.textContent = bloqueada ? 'Activa tu ubicación' : 'Confirma que estás en la sede';
    if (text) {
      text.innerHTML = bloqueada
        ? (android
          ? 'La ubicación está bloqueada para la app. Toca <strong>Abrir ajustes</strong> › Permisos › Ubicación › <strong>Permitir solo con la app en uso</strong>.'
          : locationErrorMessage('denied'))
        : 'Para confirmar que estás en la sede buscamos tu ubicación mientras marcas. Al cerrar o dejar esta pantalla se detiene la búsqueda.';
    }
    if (allow) allow.textContent = bloqueada ? (android ? 'Abrir ajustes' : 'Ya la activé') : 'Permitir ubicación';
    locPrimer.dataset.state = state;
    openSheet(locPrimer, { focus: allow });
  }
  $('#btn-loc-allow')?.addEventListener('click', async () => {
    const state = locPrimer.dataset.state;
    closeSheet(locPrimer);
    if (state === 'denied' && window.AndroidNet && typeof window.AndroidNet.openAppSettings === 'function') {
      window.AndroidNet.openAppSettings();
      return; // al volver de Ajustes se revisa de nuevo (visibilitychange)
    }
    gpsPermission = 'granted';
    retryLocation(); // ahora sí aparece el aviso del sistema
    if (scannerInstance?.active && isCameraMode()) { scannerInstance.resume(); markDetected(false); }
  });
  $('#btn-loc-later')?.addEventListener('click', () => {
    closeSheet(locPrimer);
    scannerInstance?.pause();
    setHint('Para marcar, permite la ubicación con el indicador superior.');
  });
  locationPermissionState().then((st) => {
    if (left || document.hidden) return;
    gpsPermission = st;
    if (st === 'granted' || st === 'unsupported') startLocation();
    else {
      updateLocationDisplay('denied', 'Ubicación sin permiso · tocar');
      setTimeout(() => { if (!left) showLocationPrimer(st); }, 500);
    }
  });
  // Al volver de Ajustes con la ubicación activada, se busca sola
  const onLocReturn = async () => {
    if (document.hidden || left) return;
    const st = await locationPermissionState();
    if (left || document.hidden) return;
    gpsPermission = st;
    if (st === 'granted') {
      if (['denied','unavailable','timeout'].includes(gpsState.status)) retryLocation();
      else startLocation();
    }
  };
  document.addEventListener('visibilitychange', onLocReturn);
  window.addEventListener('hashchange', () => document.removeEventListener('visibilitychange', onLocReturn), { once: true });
  const offGps = onLocationChange((s) => {
    if (gpsPermission !== 'granted' && s.status === 'searching') return; // aún sin permiso
    gpsState = s;
    if (s.status === 'denied') gpsPermission = 'denied';
    const text = {
      ready: `${s.permissionAccuracy === 'approximate' ? 'Permiso de ubicación aproximada' : 'Ubicación lista'}${s.accuracy ? ` · ±${s.accuracy} m` : ''}`,
      imprecise: s.permissionAccuracy === 'approximate' ? `Ubicación aproximada · ±${s.accuracy} m · tocar para ajustar permiso` : `Ubicación aproximada · ±${s.accuracy} m · buscando mejor señal`,
      updating: 'Actualizando ubicación…',
      searching: 'Buscando tu ubicación…',
      denied: 'Sin permiso de ubicación · tocar',
      unavailable: 'Ubicación no disponible · tocar para revisar',
      timeout: 'Sin ubicación reciente · tocar para reintentar',
      unsupported: 'Ubicación no disponible'
    }[s.status] || 'Buscando tu ubicación…';
    updateLocationDisplay(s.status, text);
    if (isProcessing && waitTimer === null && ['searching','updating','imprecise'].includes(s.status)) {
      startLocationWait(isCameraMode() ? setHint : (text) => setOtpMessage(text));
    }
  });
  const onLocationDetails = async () => {
      const bridge = window.AndroidNet;
      // Sin permiso: la hoja explica y lleva a Ajustes si hace falta
      const st = await locationPermissionState();
      if (st !== 'granted' && st !== 'unsupported') { showLocationPrimer(st); return; }
      if (gpsState.status === 'denied') {
        if (bridge && typeof bridge.openAppSettings === 'function') bridge.openAppSettings();
        else showToast(locationErrorMessage('denied'), 'warning', 7000);
      } else if (gpsState.permissionAccuracy === 'approximate' && bridge && typeof bridge.openAppSettings === 'function') {
        bridge.openAppSettings();
        return;
      } else if (gpsState.status === 'unavailable') {
        if (bridge && typeof bridge.openLocationSettings === 'function') bridge.openLocationSettings();
        else showToast(locationErrorMessage('unavailable'), 'warning', 6000);
      }
      retryLocation();
      if (scannerInstance?.active && isCameraMode()) { scannerInstance.resume(); markDetected(false); }
  };
  gpsChip?.addEventListener('click', onLocationDetails);
  manualGps?.addEventListener('click', onLocationDetails);
  const OTP_MSG_DEFAULT = otpMsg ? otpMsg.textContent : '';
  let nextTipo = null;
  let slowHintTimer = null;
  let autoSubmitTimer = null;

  const setHint = (text) => { if (hint) hint.textContent = text; };
  const isCameraMode = () => Boolean(screen && screen.dataset.mode === 'camera');

  const btnSlowManual = $('#btn-slow-manual');

  // Sin permiso de cámara no es un "error": se explica para qué se necesita y se ofrece
  // permitirla (o abrir los ajustes si quedó bloqueada), con el código siempre a mano.
  let cameraTries = 0;
  // Tras una negativa no se vuelve a pedir la cámara sola (si no, el aviso del sistema
  // reaparecía en bucle): solo al tocar "Permitir cámara" o al volver con el permiso dado
  let permissionBlocked = false;
  function showCameraHelp(error) {
    const name = error && error.name;
    permissionBlocked = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
    const titleEl = $('#camera-error-title');
    const retryText = $('#btn-retry-camera-text');
    const btnSettings = $('#btn-open-camera-settings');
    const android = Boolean(window.AndroidNet && typeof window.AndroidNet.openAppSettings === 'function');
    const permiso = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
    if (fallbackBox) {
      fallbackBox.hidden = false;
      fallbackBox.classList.toggle('is-permission', permiso);
    }
    if (permiso) {
      // Al segundo intento negado el sistema ya no vuelve a preguntar: hay que ir a Ajustes
      const bloqueado = cameraTries >= 1;
      if (titleEl) titleEl.textContent = bloqueado ? 'Activa la cámara en Ajustes' : 'Permite usar la cámara';
      if (fallbackText) {
        fallbackText.textContent = bloqueado
          ? (android
            ? 'Toca "Abrir ajustes" › Permisos › Cámara › Permitir. Luego vuelve aquí.'
            : 'Permite la cámara para este sitio en los ajustes de tu navegador y vuelve a intentarlo.')
          : 'La cámara solo se usa para leer el QR de la pantalla de asistencia. No se guardan fotos.';
      }
      if (retryText) retryText.textContent = bloqueado ? 'Ya la activé' : 'Permitir cámara';
      if (btnSettings) btnSettings.hidden = !(bloqueado && android);
    } else {
      if (titleEl) titleEl.textContent = 'No se pudo abrir la cámara';
      if (fallbackText && scannerInstance) fallbackText.textContent = scannerInstance.getFriendlyErrorMessage(error);
      if (retryText) retryText.textContent = 'Reintentar';
      if (btnSettings) btnSettings.hidden = true;
    }
  }
  $('#btn-open-camera-settings')?.addEventListener('click', () => {
    try { window.AndroidNet.openAppSettings(); } catch (_) {}
  });
  // Al volver de Ajustes con el permiso dado, la cámara se enciende sola
  const onReturn = () => {
    if (document.hidden || cameraStarting || !screen || !screen.classList.contains('is-camera-off') || !isCameraMode() || left) return;
    if (permissionBlocked) {
      // Solo si en Ajustes se dio el permiso (app Android); si no, se espera a que lo toque
      const b = window.AndroidNet;
      if (!(b && typeof b.hasCameraPermission === 'function' && b.hasCameraPermission())) return;
      permissionBlocked = false;
    }
    startCamera();
  };
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('hashchange', () => document.removeEventListener('visibilitychange', onReturn), { once: true });

  // Si pasan unos segundos sin leer nada, se sugiere qué hacer (y un acceso al código manual)
  function armSlowHint() {
    clearTimeout(slowHintTimer);
    if (btnSlowManual) btnSlowManual.hidden = true;
    slowHintTimer = setTimeout(() => {
      if (isCameraMode() && !isProcessing && scannerInstance && scannerInstance.active) {
        setHint(HINT_SLOW);
        if (btnSlowManual) btnSlowManual.hidden = false;
      }
    }, HINT_SLOW_AFTER_MS);
  }

  // Zona del marco en coordenadas del video (0..1). El video se muestra con object-fit: cover
  // (recortado) y a veces en espejo: se convierte la posición en pantalla a la del video, así
  // el lector analiza exactamente lo que el trabajador encuadra.
  function guideRegion() {
    if (!guide || !videoEl || !videoEl.videoWidth) return null;
    const v = videoEl.getBoundingClientRect();
    const g = guide.getBoundingClientRect();
    if (!v.width || !g.width) return null;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const s = Math.max(v.width / vw, v.height / vh);
    const offX = (v.width - vw * s) / 2, offY = (v.height - vh * s) / 2;
    let x = (g.left - v.left - offX) / s;
    const y = (g.top - v.top - offY) / s;
    const w = g.width / s, h = g.height / s;
    if (videoEl.classList.contains('is-mirrored')) x = vw - x - w;
    return { x: x / vw, y: y / vh, w: w / vw, h: h / vh };
  }

  // Lectura detectada: el marco se pone verde con una palomita (causa visible de la vibración).
  // El marco ya no se desplaza hacia el código: moverlo lo dejaba fuera de lugar.
  function markDetected(detected) {
    if (guide) {
      guide.classList.toggle('is-detected', detected);
      if (!detected) guide.classList.remove('is-busy');
    }
    if (btnSlowManual) btnSlowManual.hidden = true;
    setHint(detected ? 'Código leído · verificando…' : HINT_CAMERA);
    if (detected) clearTimeout(slowHintTimer);
    else armSlowHint();
  }

  // Mientras se registra la marcación, la palomita da paso a un indicador de progreso
  function setBusy(on) {
    if (guide) guide.classList.toggle('is-busy', on);
    if (on) setHint(gpsState.status === 'ready' ? 'Registrando tu marcación…' : 'Buscando tu ubicación para registrar…');
  }

  // Mientras se espera la ubicación se muestra el tiempo (como la app anterior: "12 s / 45 s")
  let waitTimer = null;
  function startLocationWait(write) {
    stopLocationWait();
    if (gpsState.status === 'ready') return;
    const t0 = Date.now();
    const max = usesNativeLocation() ? 45 : navigator.onLine ? 12 : 15;
    const tick = () => {
      if (gpsState.status === 'ready') { write('Ubicación lista · registrando…'); return; }
      const s = Math.min(max, Math.round((Date.now() - t0) / 1000));
      write(`Buscando tu ubicación: ${s} s / ${max} s. Si estás bajo techo, acércate a una ventana.`);
    };
    tick();
    waitTimer = setInterval(tick, 1000);
  }
  function stopLocationWait() {
    clearInterval(waitTimer);
    waitTimer = null;
  }

  async function ensureLocationPermission() {
    const state = await locationPermissionState();
    if (left || document.hidden) return false;
    gpsPermission = state;
    if (state !== 'granted' && state !== 'unsupported') { showLocationPrimer(state); return false; }
    if (['denied','unavailable','timeout'].includes(gpsState.status)) retryLocation();
    return true;
  }

  function cancelMark() {
    if (markController && !markController.signal.aborted) {
      interruptedMark = true;
      markController.abort();
    }
    actionGeneration++;
    isProcessing = false;
    stopLocationWait();
    clearTimeout(autoSubmitTimer);
    if (guide) guide.classList.remove('is-busy', 'is-detected');
    setSubmitting(false);
  }

  function showDeferredResult() {
    if (!deferredResult || left || document.hidden) return false;
    const { res, metodo } = deferredResult;
    deferredResult = null;
    if (res.pendiente) mostrarModalResultado(res.cancelled || res.needsSync ? 'por_confirmar' : 'pendiente', res.message, res.needsSync ? null : res.data || null, metodo);
    else mostrarModalResultado(Boolean(res.success && res.data), res.message || 'Revisa el resultado de la marcación.', res.data, metodo);
    return true;
  }

  function finishInterruptedAction() {
    if (!interruptedMark || markController || left || document.hidden) return;
    interruptedMark = false;
    if (showDeferredResult()) return;
    if (isCameraMode() && !isSheetOpen(resultModal) && !isSheetOpen(locPrimer)) startCamera();
  }

  // ── Estado de conexión y próxima marcación ──
  function paintStatus() {
    if (!statusBox || !statusText) return;
    if (!navigator.onLine) {
      statusBox.hidden = false;
      statusBox.dataset.variant = 'offline';
      statusText.textContent = 'Sin conexión · se guardará en el celular';
    } else if (nextTipo && NEXT_ACTION[nextTipo]) {
      statusBox.hidden = false;
      statusBox.dataset.variant = 'next';
      statusText.textContent = `Siguiente: ${NEXT_ACTION[nextTipo]}`;
    } else {
      statusBox.hidden = true;
    }
    if (tipoNote) {
      tipoNote.textContent = nextTipo && NEXT_ACTION[nextTipo]
        ? `Automático registrará: ${formatearTipo(nextTipo)}.`
        : 'El sistema elige según tu jornada.';
    }
  }

  async function loadNextTipo() {
    if (!navigator.onLine) return paintStatus();
    try {
      const res = await getJornadaService();
      if (res && res.success && res.data && res.data.tipo) nextTipo = res.data.tipo;
    } catch (_) {}
    if (!left) paintStatus();
  }

  // ── Cámara ──
  function resetCameraControls() {
    if (btnTorch) {
      btnTorch.hidden = !(scannerInstance && scannerInstance.active && scannerInstance.hasTorch());
      btnTorch.setAttribute('aria-pressed', 'false');
      btnTorch.classList.remove('is-on');
    }
    if (btnZoom) {
      const range = scannerInstance && scannerInstance.active ? scannerInstance.zoomRange() : null;
      btnZoom.hidden = !range;
      btnZoom.textContent = '1×';
      btnZoom.classList.remove('is-on');
    }
    if (videoEl) videoEl.classList.toggle('is-mirrored', Boolean(scannerInstance && scannerInstance.facingMode === 'user'));
  }

  // Mientras se espera el permiso de la cámara, el aviso del sistema manda la app a segundo
  // plano y la vuelve a traer: no hay que apagar ni volver a pedir la cámara en ese momento
  // (cada pedido nuevo abría otro aviso, en bucle)
  async function startCamera(switchFacing = false) {
    if (!scannerInstance || cameraStarting || markController || deferredResult || left || document.hidden || !isCameraMode()) return;
    cameraStarting = true;
    permissionBlocked = false; // El nuevo intento decidirá si el permiso sigue bloqueado.
    if (screen) screen.classList.add('is-starting');
    if (fallbackBox) fallbackBox.hidden = true;
    if (screen) screen.classList.remove('is-camera-off');
    markDetected(false);

    let res;
    try {
      res = switchFacing ? await scannerInstance.switchCamera() : await scannerInstance.start();
    } finally {
      cameraStarting = false;
    }
    if (left || !scannerInstance) return;
    if (document.hidden || !isCameraMode()) { stopCamera(); return; }
    if (screen) screen.classList.remove('is-starting');
    if (res && res.success) {
      resetCameraControls();
      armSlowHint();
    } else if (res?.cancelled && !permissionBlocked && !isSheetOpen(resultModal)) {
      // Se volvió a Cámara mientras el permiso anterior seguía pendiente.
      queueMicrotask(() => { if (!left && !document.hidden && isCameraMode()) startCamera(); });
    }
  }

  function stopCamera() {
    clearTimeout(slowHintTimer);
    if (scannerInstance) scannerInstance.stop();
    if (screen) screen.classList.remove('is-starting');
  }

  if (videoEl) {
    scannerInstance = new QRScannerController(
      videoEl,
      async (decodedQR) => {
        if (isProcessing || left || document.hidden) return;
        isProcessing = true;
        const controller = new AbortController();
        markController = controller;
        setSubmitting(true);
        const action = ++actionGeneration;
        const current = () => action === actionGeneration && !left && !document.hidden && !controller.signal.aborted;
        let busyTimer = null;
        try {
          if (!(await ensureLocationPermission()) || !current()) { try { scannerInstance?.resume(); } catch (_) {} return; }
          markDetected(true);
          busyTimer = setTimeout(() => {
            if (!isProcessing || !current()) return;
            setBusy(true);
            startLocationWait(setHint);
          }, 450);

          // Solo se envían QR de asistencia; la validez real (firma, vigencia) la decide el servidor
          const secResult = await verifySignedQR(decodedQR);
          if (!current()) return;
          if (!secResult.valid) {
            mostrarModalResultado(false, secResult.message, null);
            return;
          }

          // El tipo (entrada, almuerzo, salida…) lo decide el servidor según la jornada
          await procesarMarcacion({ token_qr: secResult.cleanToken, metodo: 'qr' }, controller.signal);
        } catch (err) {
          console.error('Error al verificar QR:', err);
          if (current()) mostrarModalResultado(false, 'No se pudo verificar la seguridad del código QR', null);
        } finally {
          clearTimeout(busyTimer);
          if (markController === controller) markController = null;
          if (action === actionGeneration) isProcessing = false;
          setSubmitting(false);
          finishInterruptedAction();
        }
      },
      (error) => {
        clearTimeout(slowHintTimer);
        if (screen) screen.classList.remove('is-starting');
        showCameraHelp(error);
        if (screen) screen.classList.add('is-camera-off');
        resetCameraControls();
      }
    );

    scannerInstance.setScanRegion(guideRegion);
    if (!startManual) startCamera();
  }

  if (btnSlowManual) btnSlowManual.addEventListener('click', showManualView);

  // Al pasar la app a segundo plano se apaga la cámara (y la linterna); al volver se reanuda
  function onVisibility() {
    if (!document.hidden && !isCameraMode()) refreshPasteChip();
    if (document.hidden) {
      cancelMark();
      stopLocation();
      // Un aviso de permiso puede ocultar la página: se descarta el flujo si llega oculto.
      if (!cameraStarting) stopCamera();
      return;
    }
    if (showDeferredResult() || markController) return;
    if (!scannerInstance || cameraStarting) return;
    if (isCameraMode() && !isSheetOpen(resultModal) && !isProcessing
      && !(screen && screen.classList.contains('is-camera-off'))) {
      // Si la cámara estaba sin permiso, lo decide onReturn (sin volver a pedirlo solo)
      startCamera();
    }
  }

  function onNetworkChange() {
    paintStatus();
    if (navigator.onLine && !nextTipo) loadNextTipo();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onNetworkChange);
  window.addEventListener('offline', onNetworkChange);

  // Al salir de la ruta: cámara apagada y escuchas retiradas
  window.addEventListener('hashchange', () => {
    left = true;
    cancelMark();
    offGps();
    stopLocation();
    clearTimeout(slowHintTimer);
    clearTimeout(autoSubmitTimer);
    stopLocationWait();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onNetworkChange);
    window.removeEventListener('offline', onNetworkChange);
    if (scannerInstance) {
      scannerInstance.stop();
      scannerInstance = null;
    }
  }, { once: true });

  // Cambio de cámara (trasera / frontal)
  if (btnSwitchCam) {
    btnSwitchCam.addEventListener('click', async () => {
      if (!scannerInstance || isProcessing || cameraStarting) return;
      btnSwitchCam.classList.add('is-spinning');
      if (screen) screen.classList.add('is-starting');
      await startCamera(true);
      btnSwitchCam.classList.remove('is-spinning');
      if (left) return;
      if (screen) screen.classList.remove('is-starting');
      resetCameraControls();
    });
  }

  // Linterna (solo si el hardware la ofrece)
  if (btnTorch) {
    btnTorch.addEventListener('click', async () => {
      if (!scannerInstance) return;
      const on = await scannerInstance.toggleTorch();
      hapticFeedback([8]);
      btnTorch.classList.toggle('is-on', on);
      btnTorch.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Zoom 1× / 2× (botón o doble toque sobre la imagen)
  async function toggleZoom() {
    if (!scannerInstance || !btnZoom || btnZoom.hidden) return;
    const range = scannerInstance.zoomRange();
    if (!range) return;
    const target = scannerInstance.zoom > range.min + 0.1 ? range.min : Math.min(2 * range.min, range.max);
    const value = await scannerInstance.setZoom(target);
    hapticFeedback([8]);
    const zoomed = value > range.min + 0.1;
    btnZoom.textContent = `${zoomed ? Math.round((value / range.min) * 10) / 10 : 1}×`;
    btnZoom.classList.toggle('is-on', zoomed);
  }
  if (btnZoom) btnZoom.addEventListener('click', toggleZoom);
  if (viewCamera) viewCamera.addEventListener('dblclick', toggleZoom);

  if (btnRetryCamera) btnRetryCamera.addEventListener('click', () => { cameraTries++; startCamera(); });

  // ── Cambio de modo ──
  // En la app Android la barra de estado acompaña al fondo: negra con la cámara, normal con el código
  function systemBarsDark(dark) {
    try {
      if (window.AndroidNet && typeof window.AndroidNet.setImmersive === 'function') window.AndroidNet.setImmersive(dark);
    } catch (_) {}
  }

  function showCameraView() {
    if (markController) return;
    clearTimeout(autoSubmitTimer);
    systemBarsDark(true);
    setActiveSegment([tabCamera, tabManual], tabCamera);
    if (screen) {
      screen.dataset.mode = 'camera';
      screen.classList.remove('kb-open');
    }
    if (manualInput) manualInput.blur();
    if (viewCamera) viewCamera.hidden = false;
    if (viewManual) viewManual.hidden = true;
    setHint(HINT_CAMERA);
    if (scannerInstance && !scannerInstance.active) startCamera();
  }

  function showManualView() {
    if (markController) return;
    systemBarsDark(false);
    setActiveSegment([tabCamera, tabManual], tabManual);
    if (screen) screen.dataset.mode = 'manual';
    if (viewCamera) viewCamera.hidden = true;
    if (viewManual) viewManual.hidden = false;
    stopCamera();
    if (manualInput) manualInput.focus({ preventScroll: true });
    refreshPasteChip();
  }

  if (tabCamera) tabCamera.addEventListener('click', showCameraView);
  if (tabManual) tabManual.addEventListener('click', showManualView);
  if (btnFromError) btnFromError.addEventListener('click', showManualView);

  // Con el teclado abierto se esconden los controles inferiores para no tapar el formulario
  if (viewManual && screen) {
    viewManual.addEventListener('focusin', (e) => {
      if (e.target && e.target.matches('input[type="tel"]')) screen.classList.add('kb-open');
    });
    viewManual.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!viewManual.contains(document.activeElement) || !document.activeElement.matches('input[type="tel"]')) {
          screen.classList.remove('kb-open');
        }
      }, 60);
    });
  }

  // ── Código manual ──
  function setOtpMessage(text, isError = false) {
    if (!otpMsg) return;
    otpMsg.textContent = text;
    otpMsg.classList.toggle('is-error', isError);
  }

  function shakeOtp() {
    if (!otp) return;
    otp.classList.remove('is-error');
    void otp.offsetWidth;
    otp.classList.add('is-error');
    hapticFeedback([30, 40, 30]);
  }

  const boxes = otp ? Array.from(otp.querySelectorAll('.otp__box')) : [];
  const paintOtp = () => {
    if (!manualInput) return;
    const value = manualInput.value;
    const focused = document.activeElement === manualInput;
    boxes.forEach((box, i) => {
      box.textContent = value[i] || '';
      box.classList.toggle('is-filled', Boolean(value[i]));
      box.classList.toggle('is-current', focused && i === Math.min(value.length, 5));
    });
    const complete = value.length === 6;
    if (otp) otp.classList.toggle('is-complete', complete);
    if (btnSubmitCode && !isProcessing) btnSubmitCode.disabled = !complete;
  };

  function scheduleAutoSubmit() {
    clearTimeout(autoSubmitTimer);
    if (!manualInput || manualInput.value.length !== 6 || isProcessing) return;
    autoSubmitTimer = setTimeout(() => {
      if (manualForm && manualInput.value.length === 6 && !isProcessing) manualForm.requestSubmit();
    }, 260);
  }

  if (manualInput) {
    manualInput.addEventListener('input', (e) => {
      const clean = manualInput.value.replace(/\D/g, '').slice(0, 6);
      if (clean !== manualInput.value) manualInput.value = clean;
      if (otp) otp.classList.remove('is-error');
      setOtpMessage(OTP_MSG_DEFAULT);
      paintOtp();
      if (btnPaste && clean.length === 6) btnPaste.hidden = true;
      // Solo cuando lo escribe o pega el usuario (no al limpiar tras un error)
      if (e.isTrusted || e.detail === 'paste') scheduleAutoSubmit();
    });
    manualInput.addEventListener('focus', paintOtp);
    manualInput.addEventListener('blur', paintOtp);
    paintOtp();
  }

  // "Pegar" solo aparece si hay un código de 6 dígitos copiado (y muestra cuál)
  let clipboardCode = '';
  const codeFromText = (text) => {
    if (!text || text.length > 64) return '';
    const m = String(text).match(/(?<!\d)(\d{3})[ -]?(\d{3})(?!\d)/);
    return m ? m[1] + m[2] : '';
  };

  async function readClipboardCode() {
    try {
      // App Android: el puente nativo devuelve solo el código, nunca el resto del texto copiado
      if (window.AndroidNet && typeof window.AndroidNet.getClipboardCode === 'function') {
        return codeFromText(window.AndroidNet.getClipboardCode());
      }
      // Navegador: solo si el permiso ya está concedido (no se le pregunta al usuario por esto)
      if (!navigator.clipboard || !navigator.permissions) return '';
      const perm = await navigator.permissions.query({ name: 'clipboard-read' });
      if (perm.state !== 'granted') return '';
      return codeFromText(await navigator.clipboard.readText());
    } catch (_) {
      return '';
    }
  }

  async function refreshPasteChip() {
    if (!btnPaste || !manualInput || isCameraMode() || left) return;
    clipboardCode = await readClipboardCode();
    const show = Boolean(clipboardCode) && manualInput.value !== clipboardCode && !isProcessing;
    const label = $('#paste-code-label');
    if (label && clipboardCode) label.textContent = `Pegar ${clipboardCode.slice(0, 3)} ${clipboardCode.slice(3)}`;
    if (show && btnPaste.hidden) {
      btnPaste.hidden = false;
      btnPaste.classList.remove('is-appearing');
      void btnPaste.offsetWidth;
      btnPaste.classList.add('is-appearing');
    } else if (!show) {
      btnPaste.hidden = true;
    }
  }

  if (btnPaste && manualInput) {
    btnPaste.addEventListener('click', () => {
      if (!clipboardCode) return;
      btnPaste.hidden = true;
      manualInput.value = clipboardCode;
      manualInput.dispatchEvent(new CustomEvent('input', { detail: 'paste' }));
    });
    // Al volver a la app (p. ej. después de copiar el código en otra) se revisa de nuevo
    window.addEventListener('focus', refreshPasteChip);
    window.addEventListener('hashchange', () => window.removeEventListener('focus', refreshPasteChip), { once: true });
  }

  function setSubmitting(busy) {
    const blocked = busy || Boolean(markController);
    if (tabCamera) tabCamera.disabled = blocked;
    if (tabManual) tabManual.disabled = blocked;
    if (btnSwitchCam) btnSwitchCam.disabled = blocked;
    if (manualInput) manualInput.disabled = blocked;
    manualForm?.querySelectorAll('input[name="tipo"]').forEach((input) => { input.disabled = blocked; });
    if (btnSubmitCode) btnSubmitCode.disabled = busy || Boolean(markController) || !(manualInput && manualInput.value.length === 6);
    if (btnCodeText) btnCodeText.hidden = busy;
    if (btnCodeSpinner) btnCodeSpinner.hidden = !busy;
    if (otp) otp.classList.toggle('is-busy', busy);
  }

  if (manualForm) {
    manualForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearTimeout(autoSubmitTimer);
      if (isProcessing || markController || deferredResult || left || document.hidden) return;
      const code = manualInput ? manualInput.value.trim() : '';
      if (!/^\d{6}$/.test(code)) {
        setOtpMessage('Faltan dígitos: el código tiene 6 números', true);
        shakeOtp();
        if (manualInput) manualInput.focus({ preventScroll: true });
        return;
      }

      isProcessing = true;
      const controller = new AbortController();
      markController = controller;
      const action = ++actionGeneration;
      if (manualInput) manualInput.blur();
      setSubmitting(true);
      startLocationWait((txt) => setOtpMessage(txt));
      const checked = manualForm.querySelector('input[name="tipo"]:checked');
      const tipo = checked ? checked.value : 'auto';
      try {
        if (!(await ensureLocationPermission()) || controller.signal.aborted || action !== actionGeneration) return;
        await procesarMarcacion({ codigo: code, metodo: 'codigo', tipo }, controller.signal);
      } finally {
        if (markController === controller) markController = null;
        if (action === actionGeneration) isProcessing = false;
        stopLocationWait();
        setSubmitting(false);
        finishInterruptedAction();
      }
    });
  }

  // ── Marcación ──
  async function procesarMarcacion(params, signal) {
    const metodo = params.metodo === 'codigo' ? 'Código manual' : 'Código QR';
    try {
      const res = await marcarAsistenciaService(params, { signal });
      const ok = Boolean(res && res.success && res.data);
      if (res.needsSync) {
        stopCamera();
        if (!left) {
          if (signal?.aborted || document.hidden) deferredResult = { res, metodo };
          else mostrarModalResultado('por_confirmar', res.message, null, metodo);
        }
        return false;
      }
      if (res.cancelled) {
        if (res.pendiente && !left) { deferredResult = { res, metodo }; stopCamera(); if (!document.hidden) showDeferredResult(); }
        return false;
      }
      if (ok && res.data.tipo === 'salida' && !res.pendiente) {
        try { window.AndroidNet?.markExitDone?.(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' })); } catch (_) {}
      }
      if (left) return ok;
      if (signal?.aborted || document.hidden) { deferredResult = { res, metodo }; stopCamera(); return ok; }

      if (res.pendiente && res.data) {
        mostrarModalResultado('pendiente', res.message || 'Marcación guardada temporalmente', res.data, metodo);
      } else if (res.success && res.data) {
        const origen = res.data.origen ? `. ${res.data.origen}` : '';
        mostrarModalResultado(true, (res.message || 'Marcación registrada con éxito') + origen, res.data, metodo);
      } else {
        mostrarModalResultado(false, res.message || 'No se pudo procesar la marcación', null);
      }
      return ok;
    } catch (err) {
      console.error('Error al marcar asistencia:', err);
      if (!left && !document.hidden && !signal?.aborted) mostrarModalResultado(false, 'No se pudo completar la marcación. Revisa tu conexión y vuelve a intentar.', null);
      return false;
    }
  }

  function setResultVisual(variant, title) {
    if (resultIconBox) resultIconBox.className = `result-icon result-icon--${variant}`;
    if (resultIconSvg) resultIconSvg.innerHTML = ICON_RESULT[variant];
    if (resultTitle) {
      resultTitle.textContent = title;
      resultTitle.className = `result-title text-${variant}`;
    }
  }

  function setDetails(datos, estadoTexto, estadoVariant, metodo) {
    if (!resultDetails) return;
    if (!datos) {
      resultDetails.hidden = true;
      return;
    }
    resultDetails.hidden = false;
    if (detailTipo) detailTipo.textContent = formatearTipo(datos.tipo) || 'Asistencia';
    if (detailHora) detailHora.textContent = (datos.hora || formatTime()).slice(0, 5);
    if (detailMetodo) detailMetodo.textContent = metodo || '-';
    if (detailEstado) {
      detailEstado.textContent = estadoTexto;
      detailEstado.className = `ios-badge ${estadoVariant}`;
    }
  }

  function closeResult(afterClose) {
    closeSheet(resultModal);
    if (afterClose) afterClose();
  }

  function volverAlEscaner() {
    if (gpsPermission === 'granted') startLocation();
    if (!isCameraMode()) {
      // Reintento con código: se limpia el campo y se vuelve a enfocar
      if (manualInput) {
        manualInput.value = '';
        manualInput.dispatchEvent(new Event('input'));
        manualInput.focus({ preventScroll: true });
      }
      shakeOtp();
      return;
    }
    markDetected(false);
    if (!scannerInstance) return;
    // La cámara pudo apagarse (app en segundo plano); si sigue encendida basta con reanudar
    if (scannerInstance.active) scannerInstance.resume();
    else startCamera();
  }

  const goBack = () => closeResult(() => { window.location.hash = `#${getReturnRoute()}`; });

  // Animación del ícono y vibración disparadas en el mismo cuadro, cuando la hoja ya llegó
  function celebrate(kind) {
    if (!resultIconBox) return;
    resultIconBox.classList.remove('is-animating');
    setTimeout(() => {
      requestAnimationFrame(() => {
        if (left || document.hidden) return;
        resultIconBox.classList.add('is-animating');
        playFeedback(kind);
      });
    }, 220);
  }

  function mostrarModalResultado(tipoResultado, mensaje, datos, metodo) {
    if (!resultModal || left) return;
    stopCamera();
    stopLocation();
    clearTimeout(slowHintTimer);
    stopLocationWait();
    if (otpMsg) setOtpMessage(OTP_MSG_DEFAULT);
    if (guide) guide.classList.remove('is-busy');
    if (tipoResultado !== true && tipoResultado !== 'pendiente' && tipoResultado !== 'por_confirmar' && guide) guide.classList.remove('is-detected');
    let feedback = 'error';

    if (tipoResultado === 'pendiente' || tipoResultado === 'por_confirmar') {
      // Guardada sin conexión, pendiente de sincronizar
      feedback = 'warning';
      setResultVisual('warning', tipoResultado === 'por_confirmar' ? 'Pendiente de confirmar' : 'Guardada sin conexión');
      if (resultMsg) {
        resultMsg.innerHTML = tipoResultado === 'por_confirmar'
          ? '<strong>Hay una solicitud pendiente de confirmar.</strong><br><span class="result-message__note">Revisa su estado antes de volver a marcar. Se comprobará con el mismo identificador.</span>'
          : '<strong>Pendiente de sincronización</strong><br><span class="result-message__note">Se enviará automáticamente cuando regrese Internet.</span>';
      }
      setDetails(datos, 'Pendiente', 'badge-warning', metodo);
      if (btnScanAgain) btnScanAgain.hidden = true;
      if (btnAcceptResult) {
        btnAcceptResult.textContent = tipoResultado === 'por_confirmar' ? 'Revisar sincronización' : 'Entendido';
        btnAcceptResult.onclick = tipoResultado === 'por_confirmar' ? () => closeResult(() => { window.location.hash = '#home?sync=1'; }) : goBack;
      }
    } else if (tipoResultado === true && datos && datos.estado === 'ya_registrada') {
      // El servidor no registró nada nuevo: esa marcación ya existía (p. ej. doble escaneo)
      feedback = 'warning';
      setResultVisual('warning', 'Ya estaba registrada');
      const hora = datos.hora ? ` a las ${String(datos.hora).slice(0, 5)}` : '';
      if (resultMsg) resultMsg.textContent = `Ya tenías registrada tu ${(formatearTipo(datos.tipo) || 'marcación').toLowerCase()}${hora}. No se registró nada nuevo.`;
      setDetails(datos, 'Ya registrada', 'badge-warning', metodo);
      if (btnScanAgain) btnScanAgain.hidden = true;
      if (btnAcceptResult) {
        btnAcceptResult.textContent = 'Entendido';
        btnAcceptResult.onclick = goBack;
      }
    } else if (tipoResultado === true) {
      // Éxito confirmado por el servidor
      feedback = 'success';
      setResultVisual('success', '¡Marcación registrada!');
      if (resultMsg) resultMsg.textContent = mensaje;
      const tarde = Boolean(datos && datos.estado && String(datos.estado).includes('tarde'));
      const estado = String((datos && datos.estado) || 'Normal');
      setDetails(datos, tarde ? 'Tardanza' : estado.charAt(0).toUpperCase() + estado.slice(1), tarde ? 'badge-warning' : 'badge-success', metodo);
      if (btnScanAgain) btnScanAgain.hidden = true;
      if (btnAcceptResult) {
        btnAcceptResult.textContent = 'Listo';
        btnAcceptResult.onclick = goBack;
      }
    } else {
      // Error o rechazo por el servidor
      setResultVisual('danger', 'Marcación no realizada');
      if (resultMsg) resultMsg.textContent = mensaje;
      setDetails(null);

      const resume = () => closeResult(volverAlEscaner);
      if (btnScanAgain) {
        btnScanAgain.hidden = false;
        btnScanAgain.textContent = 'Salir';
        btnScanAgain.onclick = goBack;
      }
      if (btnAcceptResult) {
        btnAcceptResult.textContent = isCameraMode() ? 'Escanear de nuevo' : 'Intentar de nuevo';
        btnAcceptResult.onclick = resume;
      }
    }

    openSheet(resultModal, { focus: btnAcceptResult });
    celebrate(feedback);
  }

  // ── Arranque ──
  if (startManual) showManualView();
  else setActiveSegment([tabCamera, tabManual], tabCamera);
  paintStatus();
  loadNextTipo();
}

function formatearTipo(tipo) {
  switch (tipo) {
    case 'entrada': return 'Entrada';
    case 'almuerzo': return 'Salida a almuerzo';
    case 'regreso_almuerzo': return 'Retorno de almuerzo';
    case 'salida': return 'Salida';
    case 'salida_temporal': return 'Salida temporal';
    case 'retorno_temporal': return 'Retorno temporal';
    case 'auto': return 'Automática';
    default: return tipo || '';
  }
}
