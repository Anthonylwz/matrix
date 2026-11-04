// Pantalla de Autenticación / Login
import { $, showToast, APP_VERSION, showActionSheet } from '../js/utils.js';
import { biometricAvailable, biometricEnabled, biometricOwner, forgetOtherWorkerBiometric, enableBiometric, unlockWithBiometric, disableBiometric, wasOffered, markOffered } from '../js/biometric.js';
import { icon } from '../js/icons.js';
import { loginService, checkServerStatus } from '../js/api.js';
import { validateDni, saveSession, getDeviceId, describeDevice, rememberPassword, unlockOffline, getUser, accountDni, clearSession, markNeedsOnline } from '../js/auth.js';
import { getServerKey } from '../js/server-context.js';

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(container) {
  // Celular ya vinculado: se saluda por el nombre y se puede entrar incluso sin Internet
  const cuenta = getUser();
  const nombre = cuenta ? String(cuenta.nombres || cuenta.nombre || '').split(' ')[0] : '';
  container.innerHTML = `
    <div class="login">
      <!-- Logo oficial del Instituto IDEAS (letras blancas: va sobre fondo oscuro) -->
      <div class="brand-lockup">
        <img src="../public/img/ideas-official.png" alt="Instituto IDEAS" class="brand-lockup__logo" width="201" height="79">
      </div>

      <h1 class="login__title">${cuenta ? `Hola, ${escapeHtml(nombre || 'de nuevo')}` : 'Hola de nuevo'}</h1>
      <p class="login__subtitle">${cuenta ? 'Escribe tu contraseña para entrar. Funciona también sin Internet.' : 'Ingresa con tu cuenta de IDEAS'}</p>


      <!-- Ingreso con huella (solo si se activó en este celular) -->
      <button type="button" id="btn-login-biometric" class="bio-login" hidden>
        <span class="bio-login__icon">${icon('fingerprint')}</span>
        <span class="bio-login__text">
          <span class="bio-login__title">Ingresar con huella</span>
          <span id="bio-login-sub" class="bio-login__sub">Sin escribir tu contraseña</span>
        </span>
      </button>

      <!-- Tarjeta de Login -->
      <div class="ios-card login__card">
        <form id="login-form" novalidate>
          <div class="ios-input-group">
            <label class="ios-label" for="login-dni">DNI o usuario</label>
            <div class="input-icon">
              ${icon('idcard', 'input-icon__svg')}
              <input
                type="text"
                id="login-dni"
                class="ios-input"
                placeholder="Tu DNI o usuario"
                maxlength="100"
                inputmode="text"
                autocomplete="username"
                required
              >
            </div>
          </div>

          <div class="ios-input-group">
            <label class="ios-label" for="login-password">Contraseña</label>
            <div class="input-with-action input-icon">
              ${icon('key', 'input-icon__svg')}
              <input
                type="password"
                id="login-password"
                class="ios-input"
                placeholder="Tu contraseña"
                autocomplete="current-password"
                required
              >
              <button type="button" id="btn-toggle-password" class="input-action" aria-label="Mostrar contraseña">
                <span id="icon-eye-open">${icon('eye')}</span>
                <span id="icon-eye-closed" hidden>${icon('eyeoff')}</span>
              </button>
            </div>
          </div>

          <!-- Mensaje de Error -->
          <div id="login-error" class="inline-alert inline-alert--danger" role="alert" hidden></div>

          <!-- Botón de Envío con Estado de Carga -->
          <button type="submit" id="btn-submit-login" class="ios-btn ios-btn-primary">
            <span id="btn-text">Iniciar sesión</span>
            <span id="btn-spinner" class="spinner spinner--sm" hidden></span>
          </button>
        </form>
      </div>

      <div class="login__footer">
        <!-- Estado informativo; los ajustes están en Perfil. -->
        <span class="server-status" role="status" aria-live="polite">
          <span id="server-dot" class="status-dot"></span>
          <span id="server-status-text">Comprobando conexión…</span>
        </span>
        <span class="login__version">Instituto IDEAS · v${APP_VERSION}</span>
      </div>
    </div>
  `;
}

export function init() {
  const form = $('#login-form');
  const dniInput = $('#login-dni');
  const passInput = $('#login-password');
  const toggleBtn = $('#btn-toggle-password');
  const iconEyeOpen = $('#icon-eye-open');
  const iconEyeClosed = $('#icon-eye-closed');
  const errorBox = $('#login-error');
  const submitBtn = $('#btn-submit-login');
  const btnText = $('#btn-text');
  const btnSpinner = $('#btn-spinner');
  const serverDot = $('#server-dot');
  const serverText = $('#server-status-text');

  // DNI del trabajador vinculado precargado: solo falta la contraseña
  if (dniInput && accountDni() && !dniInput.value) dniInput.value = accountDni();

  // La misma entrada admite DNI y nombres de usuario; el servidor identifica la cuenta.
  if (dniInput) {
    dniInput.addEventListener('input', () => {
      hideError();
    });
  }

  // Alternar visibilidad de contraseña
  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      toggleBtn.setAttribute('aria-label', isPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
      if (iconEyeOpen && iconEyeClosed) {
        iconEyeOpen.hidden = isPass;
        iconEyeClosed.hidden = !isPass;
      }
    });
  }

  const bridge = window.AndroidNet;
  let serverOk = null;
  let retryTimer = null;
  let leftLogin = false;
  let biometricAttempt = 0;
  let biometricPending = false;
  let biometricAutoTimer = null;
  let healthController = null;
  let healthGeneration = 0;


  function cancelServerCheck() {
    clearTimeout(retryTimer);
    healthGeneration++;
    healthController?.abort();
    healthController = null;
  }

  // Estado informativo; conserva la comprobación y el reintento de conexión.
  function setServerStatus(ok, text) {
    serverOk = ok;
    if (serverDot) serverDot.className = `status-dot ${ok ? 'status-dot--success' : 'status-dot--danger'}`;
    if (serverText) serverText.textContent = text;
  }

  // Comprobar disponibilidad real del servidor (si falla, se reintenta solo cada 10 s)
  async function checkServer(showLoading = false) {
    clearTimeout(retryTimer);
    if (leftLogin || document.hidden || healthController) return;
    const controller = new AbortController();
    healthController = controller;
    const generation = ++healthGeneration;
    const server = getServerKey();
    if (showLoading && serverText) serverText.textContent = 'Comprobando conexión…';
    try {
      const res = await checkServerStatus({ signal: controller.signal, timeoutMs: 6000 });
      if (controller.signal.aborted || generation !== healthGeneration || leftLogin || document.hidden || server !== getServerKey() || res?.cancelled) return;
      if (res && res.success) {
        setServerStatus(true, 'Servidor en línea');
      } else {
        setServerStatus(false, navigator.onLine ? 'Servidor no disponible' : 'Sin conexión');
      }
    } catch (_) {
      if (controller.signal.aborted || generation !== healthGeneration || leftLogin || document.hidden || server !== getServerKey()) return;
      setServerStatus(false, 'Sin conexión');
    } finally {
      if (healthController === controller) {
        healthController = null;
        if (!serverOk && !leftLogin && !document.hidden && !controller.signal.aborted && server === getServerKey())
          retryTimer = setTimeout(() => checkServer(), 10000);
      }
    }
  }
  checkServer(true);

  try { bridge?.setLoginServerControlsVisible?.(true); } catch (_) {}
  // Al volver de los ajustes del servidor se vuelve a comprobar aunque estuviera en línea
  let forceRecheck = false;
  const recheck = () => {
    if (leftLogin) return;
    if (document.hidden) { cancelServerCheck(); return; }
    if (serverOk !== true || forceRecheck) { forceRecheck = false; checkServer(true); }
  };
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('online', recheck);
  window.addEventListener('hashchange', () => {
    leftLogin = true;
    biometricAttempt++;
    clearTimeout(biometricAutoTimer);
    cancelServerCheck();
    try { bridge?.setLoginServerControlsVisible?.(true); } catch (_) {}
    window.removeEventListener('focus', recheck);
    document.removeEventListener('visibilitychange', recheck);
    window.removeEventListener('online', recheck);
  }, { once: true });

  // ── Huella ──
  const bioBtn = $('#btn-login-biometric');
  const bioSub = $('#bio-login-sub');
  let viaHuella = false;
  let viaHuellaServer = null;
  if (bioBtn && biometricEnabled() && biometricAvailable()) {
    bioBtn.hidden = false;
    bioBtn.addEventListener('click', () => loginWithBiometric());
    // Como Yape: al abrir, la huella se pide sola (una vez)
    biometricAutoTimer = setTimeout(() => { if (!leftLogin && !document.hidden && !window.__bioAutoAsked && workerBiometricSelected()) { window.__bioAutoAsked = true; loginWithBiometric(); } }, 450);
  }

  const workerBiometricSelected=()=>{const type=document.getElementById('login-account-type')?.value;return !type||['automatico','trabajador'].includes(type);};
  async function loginWithBiometric() {
    if(!workerBiometricSelected())return;
    if (leftLogin || document.hidden || biometricPending || submitBtn?.disabled) return;
    const server = getServerKey();
    const owner=biometricOwner(),expectedDni=dniInput?.value.trim()||owner?.dni||'',expectedAccountId=getUser()?.id||owner?.accountId||null;
    if(owner?.accountType==='trabajador'&&expectedDni&&owner.dni!==expectedDni){showError('La huella está vinculada a otro DNI. Usa la contraseña para ingresar con esa cuenta.');return;}
    const attempt = ++biometricAttempt;
    biometricPending = true;
    hideError();
    let r;
    try { r = await unlockWithBiometric({accountType:'trabajador',expectedDni,expectedAccountId}); }
    finally { biometricPending = false; }
    if (leftLogin || document.hidden || attempt !== biometricAttempt) return;
    if(!workerBiometricSelected()){if(r)r.password='';return;}
    if (r.error) {
      if (r.error === 'reenroll_required' || r.error === 'server_mismatch' || r.error === 'server_changed') {
        if (bioSub) bioSub.textContent = 'Actívala de nuevo para este servidor en Perfil';
        showError('La huella guardada no está vinculada a este servidor. Ingresa con su contraseña y vuelve a activarla en Perfil.');
      } else if (r.error === 'invalidated') {
        bioBtn.hidden = true;
        showError('Las huellas del celular cambiaron. Por seguridad, ingresa con tu contraseña y vuelve a activar la huella.');
      } else if (r.error === 'account_mismatch') {
        showError('La huella pertenece a otra cuenta. Ingresa con tu contraseña y actívala de nuevo desde Perfil.');
      } else if (r.error === 'lockout') {
        showError('Demasiados intentos con la huella. Espera un momento o ingresa con tu contraseña.');
      } else if (r.error !== 'cancelled') {
        showError('No se pudo leer la huella. Ingresa con tu contraseña.');
      }
      if (r.error === 'cancelled' && passInput) passInput.focus();
      return;
    }
    if (!server || r.server_key !== server || getServerKey() !== server) {
      if (passInput) passInput.value = '';
      showError('El servidor cambió. Ingresa con la contraseña del servidor seleccionado.');
      return;
    }
    if((dniInput?.value.trim()||owner?.dni||'')!==expectedDni){r.password='';showError('El DNI cambió durante la lectura. Ingresa con la contraseña de esa cuenta.');return;}
    if (dniInput) dniInput.value = r.dni;
    if (passInput) passInput.value = r.password;
    viaHuella = true;
    viaHuellaServer = server;
    if (leftLogin || getServerKey() !== server) {
      viaHuella = false;
      viaHuellaServer = null;
      if (passInput) passInput.value = '';
      showError('El servidor cambió. Ingresa con la contraseña del servidor seleccionado.');
      return;
    }
    // La bóveda fue verificada como trabajador: no reutilizar su contraseña para detectar otro rol.
    const selectedAccount=document.getElementById('login-account-type');
    if(selectedAccount){selectedAccount.value='trabajador';selectedAccount.dispatchEvent(new Event('change'));}
    r.password='';
    form.requestSubmit();
  }

  // Envío del formulario de Login
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if(submitBtn?.disabled || biometricPending)return;

      const dni = dniInput ? dniInput.value.trim() : '';
      const pass = passInput ? passInput.value : '';
      const conHuella = viaHuella;
      const biometricServer = viaHuellaServer;
      const loginServer = getServerKey();
      viaHuella = false;
      viaHuellaServer = null;
      if (conHuella && (!biometricServer || biometricServer !== loginServer)) {
        if (passInput) passInput.value = '';
        showError('El servidor cambió. Ingresa con la contraseña del servidor seleccionado.');
        return;
      }

      // Validaciones locales iniciales
      if (!validateDni(dni)) {
        showError('El DNI debe tener exactamente 8 dígitos numéricos.');
        if (dniInput) dniInput.focus();
        return;
      }

      if (!pass) {
        showError('Por favor introduce tu contraseña.');
        if (passInput) passInput.focus();
        return;
      }

      // Activar estado de carga en el botón
      setLoading(true);
      hideError();

      // Entrada local: valida la contraseña contra el verificador guardado en este celular
      const entrarSinConexion = async () => {
        const r = await unlockOffline(dni, pass);
        if (r.ok) {
          if (passInput) passInput.value = '';
          showToast('Sin conexión: puedes marcar. Se enviará cuando vuelva Internet.', 'warning', 5000);
          window.location.hash = '#home';
          return;
        }
        const cuenta = getUser();
        const msg = {
          password: 'La contraseña no coincide con la que usaste la última vez en este celular.',
          throttled: `Demasiados intentos. Espera ${Math.ceil((r.waitSeconds || 60) / 60)} minuto(s) o conéctate a Internet.`,
          expired: 'Hace más de 30 días que no entras con Internet. Conéctate para iniciar sesión.',
          needs_online: 'Tu sesión fue cerrada desde el servidor. Conéctate a Internet para entrar.',
          session_changed: 'Tu cuenta o el servidor cambió durante la verificación. Vuelve a ingresar.',
          other_account: `Sin conexión solo puede entrar ${cuenta ? (cuenta.nombres || 'el trabajador vinculado') : 'el trabajador vinculado'} en este celular.`,
          unknown: 'Sin conexión. Para entrar sin Internet, primero inicia sesión una vez con Internet en este celular.'
        }[r.reason] || 'No se pudo entrar sin conexión.';
        if (r.reason === 'password' && passInput) passInput.value = '';
        showError(`Sin conexión con el servidor. ${msg}`);
      };

      try {
        // Sin red y con la cuenta de este celular: se entra al instante, sin esperar al servidor
        if (!navigator.onLine && dni === accountDni()) {
          await entrarSinConexion();
          return;
        }

        const deviceData = { deviceToken: getDeviceId(), ...describeDevice() };

        const response = await loginService(dni, pass, deviceData, { timeoutMs: 8000 });
        if (leftLogin || getServerKey() !== loginServer) return;
        if (response.cancelled) {
          showError('Se interrumpió el ingreso. Inténtalo nuevamente.');
          return;
        }

        if (response.success && response.data && response.data.token_sesion) {
          forgetOtherWorkerBiometric(response.data.trabajador_id||response.data.id,dni,loginServer);
          // Entró otro trabajador: se borra la cuenta anterior de este celular (sus pendientes se conservan)
          const anterior = getUser();
          if (anterior && String(anterior.id) !== String(response.data.trabajador_id)) await clearSession();
          // Guardar sesión y redirigir
          await saveSession(response.data, response.data.token_sesion);
          // Para poder volver a entrar (y marcar) sin Internet en este celular
          let recordada = false;
          try { recordada = await rememberPassword(response.data, pass); } catch (_) {}
          if (!recordada) console.warn('No se pudo guardar el acceso sin conexión en este celular');
          if (leftLogin || getServerKey() !== loginServer) {
            if (getUser()) window.location.hash = '#home';
            return;
          }
          if (passInput) passInput.value = '';

          // Primera vez con contraseña en un celular con huella: se ofrece activarla (una vez)
          if (!conHuella && biometricAvailable() && !biometricEnabled() && !wasOffered(dni)) {
            markOffered(dni);
            const choice = await showActionSheet({
              title: '¿Ingresar con tu huella?',
              message: 'La próxima vez entrarás con tu huella, sin escribir la contraseña. Se guarda cifrada en este celular.',
              actions: [{ label: 'Activar huella', value: 'yes' }],
              cancelLabel: 'Ahora no'
            });
            if (choice === 'yes') {
              if (leftLogin || getServerKey() !== loginServer) return;
              const ok = await enableBiometric(dni, pass, { serverKey: loginServer });
              showToast(ok ? 'Listo: la próxima vez entra con tu huella' : 'No se activó la huella. Puedes hacerlo desde Perfil.', ok ? 'success' : 'info');
            }
          }

          showToast(`¡Bienvenido, ${response.data.nombres || 'Colaborador'}!`, 'success');

          // Navegar a la pantalla de inicio
          window.location.hash = '#home';
        } else if (response.offline || response.status === 0 || response.invalidResponse
          || response.status === 408 || response.status >= 500) {
          // Sin Internet o servidor caído (incluye 500 y respuestas no JSON): entrada local
          await entrarSinConexion();
        } else {
          // El servidor desvinculó o bloqueó este celular: ya no se permite entrar sin conexión
          if (response.status === 403 && dni === accountDni()) markNeedsOnline();
          // La contraseña guardada con la huella ya no sirve (se cambió): se desactiva
          if (conHuella && response.status === 401) {
            disableBiometric();
            if (bioBtn) bioBtn.hidden = true;
            if (passInput) passInput.value = '';
            showError('Tu contraseña cambió. Ingresa con la nueva y vuelve a activar la huella.');
            return;
          }
          if (conHuella && passInput) passInput.value = '';
          // Mostrar mensaje de error del servidor o genérico
          const msg = response.message || 'Credenciales incorrectas o trabajador no activo.';
          showError(msg);
        }
      } catch (err) {
        showError('Ocurrió un problema de conexión. Inténtalo nuevamente.');
      } finally {
        setLoading(false);
      }
    });
  }

  function showError(msg) {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }
  }

  function hideError() {
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
  }

  function setLoading(loading) {
    if (submitBtn) submitBtn.disabled = loading;
    if (dniInput) dniInput.disabled = loading;
    if (passInput) passInput.disabled = loading;
    const selectedAccount=document.getElementById('login-account-type');
    if(selectedAccount)selectedAccount.disabled=loading;
    if(bioBtn)bioBtn.disabled=loading;
    if (btnText) btnText.hidden = loading;
    if (btnSpinner) btnSpinner.hidden = !loading;
  }
}
