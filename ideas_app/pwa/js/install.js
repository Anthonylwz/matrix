// Módulo de detección de entorno iOS, modo Standalone y guía de instalación PWA
import { $, openSheet, closeSheet, ICON_CLOSE } from './utils.js';

let deferredPrompt = null;

// Detecta si el dispositivo es un iPhone / iPad / iPod
export function isIOS() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// Detecta si la aplicación está ejecutándose en modo standalone (instalada en pantalla de inicio)
export function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

// Inicializa el gestor de instalación
export function initInstallManager() {
  const isIosDevice = isIOS();
  const isInstalled = isStandalone();

  // Agregar clase CSS al body para permitir ajustes según el modo
  if (isInstalled) {
    document.body.classList.add('pwa-standalone');
  } else {
    document.body.classList.add('pwa-browser');
  }

  // Capturar evento estándar de instalación en navegadores compatibles (Android/Chrome/Edge)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa:installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.body.classList.remove('pwa-browser');
    document.body.classList.add('pwa-standalone');
    hideIosInstallSheet();
  });

  // Si es iOS Safari y no está instalada, mostrar el banner / modal
  if (isIosDevice && !isInstalled) {
    setupAutoIosPrompt();
  }

  // Escuchar eventos para abrir la guía manualmente
  window.addEventListener('open-ios-install-guide', () => {
    showIosInstallSheet(true);
  });
}

// Configura la visualización automática no intrusiva en iOS
function setupAutoIosPrompt() {
  const lastDismissed = localStorage.getItem('ios_install_dismissed_at');
  const now = Date.now();

  // Si ya fue descartado hace menos de 48 horas, no volver a molestar automáticamente
  if (lastDismissed && (now - parseInt(lastDismissed, 10)) < 48 * 60 * 60 * 1000) {
    return;
  }

  // Mostrar tras 3.5 segundos de navegación inicial
  setTimeout(() => {
    if (!isStandalone()) {
      showIosInstallSheet(false);
    }
  }, 3500);
}

// Muestra el modal sheet nativo de instalación en iOS
export function showIosInstallSheet(forced = false) {
  let modal = $('#ios-install-modal');

  if (!modal) {
    createInstallModalDOM();
    modal = $('#ios-install-modal');
  }

  openSheet(modal);
}

// Oculta el modal sheet de instalación
export function hideIosInstallSheet() {
  closeSheet($('#ios-install-modal'));
  localStorage.setItem('ios_install_dismissed_at', Date.now().toString());
}

// Dispara la instalación nativa si el navegador soporta prompt estándar
export async function triggerNativeInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome === 'accepted';
  }
  return false;
}

// Crea la estructura del modal sheet de instalación en el DOM
function createInstallModalDOM() {
  const existing = document.getElementById('ios-install-modal');
  if (existing) return;

  const div = document.createElement('div');
  div.id = 'ios-install-modal';
  div.className = 'sheet-backdrop';
  div.hidden = true;

  div.innerHTML = `
    <div class="sheet" aria-labelledby="install-title">
      <div class="sheet__grabber"></div>

      <div class="install-sheet-header">
        <img src="icons/apple-touch-icon.png" class="install-app-icon" alt="Icono Asistencia Ideas">
        <div class="install-sheet-header__text">
          <h3 id="install-title" class="install-sheet-title">Instalar Asistencia Ideas</h3>
          <p class="install-sheet-sub">Agrega la aplicación a tu iPhone para disfrutar de la experiencia a pantalla completa sin barras de navegación.</p>
        </div>
        <button type="button" id="btn-close-install-modal" class="icon-btn" aria-label="Cerrar">${ICON_CLOSE}</button>
      </div>

      <div class="install-steps-container">
        <!-- Paso 1 -->
        <div class="install-step">
          <div class="step-badge">1</div>
          <div class="step-text">
            Pulsa el botón <strong>Compartir</strong>
            <span class="ios-inline-icon">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </span>
            en la barra inferior o superior de Safari.
          </div>
        </div>

        <!-- Paso 2 -->
        <div class="install-step">
          <div class="step-badge">2</div>
          <div class="step-text">
            Desplaza las opciones y selecciona <strong>"Agregar a pantalla de inicio"</strong>
            <span class="ios-inline-icon">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="4"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </span>.
          </div>
        </div>

        <!-- Paso 3 -->
        <div class="install-step">
          <div class="step-badge">3</div>
          <div class="step-text">
            Pulsa <strong>"Agregar"</strong> en la esquina superior derecha para finalizar.
          </div>
        </div>
      </div>

      <!-- Indicador animado apuntando hacia el botón de Safari -->
      <div class="install-pointer">
        <span>El icono de compartir se encuentra en la barra de Safari</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <polyline points="19 12 12 19 5 12"></polyline>
        </svg>
      </div>

      <button type="button" id="btn-dismiss-install-modal" class="ios-btn ios-btn-primary">
        <span>Entendido</span>
      </button>
    </div>
  `;

  document.body.appendChild(div);

  const closeBtn = document.getElementById('btn-close-install-modal');
  const dismissBtn = document.getElementById('btn-dismiss-install-modal');

  if (closeBtn) closeBtn.addEventListener('click', hideIosInstallSheet);
  if (dismissBtn) dismissBtn.addEventListener('click', hideIosInstallSheet);

  div.addEventListener('click', (e) => {
    if (e.target === div) localStorage.setItem('ios_install_dismissed_at', Date.now().toString());
  });
}
