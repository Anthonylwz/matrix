import { staffSession, unifiedLogin, storeStaffSession } from './staff-api.js';
import { accountDni } from './auth.js';
import { studentSession, acceptStudentLogin } from './student-api.js';
import { useProfileServerControls } from './student-server.js';
import { icon } from './icons.js';
import { biometricEnabled } from './biometric.js';
import { isBundledAndroid, prepareAppRuntime } from './app-runtime.js';
import { lastAccount, rememberLastAccount, forgetLastAccount, announceDetectedAccount, detectedType, ACCOUNT_LABELS } from './login-assist.js';
// Servidor se configura desde Perfil; tampoco se muestra el pie nativo en el login.
useProfileServerControls();
// Cubre el shell mientras se redirige o se carga la sesión del alumno (evita ver pantallas intermedias).
const beginBoot=()=>document.documentElement.classList.add('sa-boot');
let booted=false;
const endBoot=()=>{if(booted)return;booted=true;const splash=document.getElementById('sa-splash');splash?.classList.add('is-leaving');setTimeout(()=>{document.documentElement.classList.remove('sa-boot');splash?.classList.remove('is-leaving');},260);};
window.addEventListener('focus', useProfileServerControls);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)useProfileServerControls();});
// También se comprueban actualizaciones al abrir como alumno, sin cargar el módulo de trabajadores.
if('serviceWorker' in navigator&&!isBundledAndroid()){
  navigator.serviceWorker.register(new URL('../service-worker.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname}).then(registration=>registration.update()).catch(()=>{});
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Tipo elegido a mano en "Opciones de acceso": solo dura mientras la app siga abierta.
const MANUAL_KEY='ideas-login-type-manual';
const choiceIcons={trabajador:'briefcase',alumno:'graduation-cap',intranet:'book',administracion:'shield',asistencia:'shield'};
function startApp(){
let studentAccessPending=false;
if(staffSession()){
  import('./staff-app.js').then(module=>module.initStaffApp()).then(endBoot).catch(()=>{document.getElementById('app-view').textContent='No se pudo cargar el panel. Cierra y vuelve a abrir la app.';endBoot();});
} else if(studentSession()) {
  import('./student-app.js').then(module=>{module.initStudentApp();requestAnimationFrame(()=>requestAnimationFrame(endBoot));setTimeout(endBoot,600);}).catch(()=>{
    document.getElementById('app-view').textContent='No se pudo cargar tu cuenta. Cierra y vuelve a abrir la app.';endBoot();
  });
} else {
  // Sin sesión válida (p. ej. cambió el servidor): se libera la pantalla de arranque para mostrar el login.
  document.documentElement.classList.remove('sa-boot');
  // Contraseña retenida unos segundos cuando el servidor pide elegir entre varias cuentas,
  // para no obligar a escribirla de nuevo. Nunca se guarda en almacenamiento.
  let choicePassword='',choiceTimer=null;
  const keepChoicePassword=value=>{clearTimeout(choiceTimer);choicePassword=value;choiceTimer=setTimeout(()=>{choicePassword='';},120000);};
  const takeChoicePassword=()=>{clearTimeout(choiceTimer);const value=choicePassword;choicePassword='';return value;};
  // Cambios de tipo hechos por la propia app (detección) no cuentan como elección manual; si la app
  // pasó al acceso de trabajador, login.js vuelve a la detección automática al terminar.
  const setAccountType=(select,value)=>{select.dataset.auto='1';if(value==='trabajador')select.dataset.autoWorker='1';else delete select.dataset.autoWorker;select.value=value;select.dispatchEvent(new Event('change'));};
  // Se añade a la pantalla existente sin reemplazar el acceso ni las funciones de trabajadores.
  function enhanceLogin() {
    const form=document.getElementById('login-form');
    if(!form||form.querySelector('#login-account-type'))return;
    // Versiones anteriores fijaban el último tipo elegido; ahora la cuenta se reconoce sola.
    try{localStorage.removeItem('ideas-account-preference');}catch{}
    const wrapper=document.createElement('div'); wrapper.className='ios-input-group login-role-manual'; wrapper.id='login-role-manual'; wrapper.hidden=true;
    wrapper.innerHTML='<label class="ios-label" for="login-account-type">Tipo de cuenta</label><select id="login-account-type" class="ios-input"><option value="automatico">Detectar mi cuenta</option><option value="trabajador">Trabajador · Asistencia</option><option value="alumno">Mi cuenta de intranet</option><option value="administracion">Administración · Asistencia</option></select><p id="student-login-hint" class="student-login-hint" hidden>Usa el mismo DNI y contraseña con los que ingresas a la intranet.</p>';
    form.prepend(wrapper);
    // Indicador de detección automática (o del tipo elegido a mano, con opción de volver a automático).
    const detect=document.createElement('div');detect.className='login-detect';detect.id='login-detect';detect.setAttribute('role','status');detect.setAttribute('aria-live','polite');
    form.prepend(detect);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='login-role-toggle';toggle.id='login-role-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','login-role-manual');
    toggle.innerHTML=`${icon('dots')}<span>Elegir tipo de cuenta manualmente</span>`;
    form.append(toggle);
    const biometricButton=document.createElement('button');biometricButton.type='button';biometricButton.id='student-login-biometric';biometricButton.className='bio-login student-bio-login';biometricButton.hidden=true;
    biometricButton.innerHTML=`<span class="bio-login__icon">${icon('fingerprint')}</span><span class="bio-login__text"><span class="bio-login__title">Ingresar con huella</span><span class="bio-login__sub">Tu cuenta de alumno</span></span>`;
    form.closest('.login__card').before(biometricButton);
    try{const notice=sessionStorage.getItem('ideas-student-login-notice');if(notice){const message=document.createElement('p');message.className='student-login-hint login-notice';message.setAttribute('role','status');message.textContent=notice;detect.after(message);sessionStorage.removeItem('ideas-student-login-notice');}}catch{}
    const select=wrapper.querySelector('select');
    select.value='automatico';
    // 'ideas-login-type' lo dejan otras pantallas como pista (p. ej. sesión de alumno vencida): ya no fija el tipo,
    // solo prepara la huella correcta. La elección manual se respeta mientras la app siga abierta.
    let hint='';
    try {
      hint=sessionStorage.getItem('ideas-login-type')||'';sessionStorage.removeItem('ideas-login-type');
      const manual=sessionStorage.getItem(MANUAL_KEY);if(['alumno','trabajador','administracion'].includes(manual))select.value=manual;
    } catch {}
    const remembered=lastAccount();
    const hintType=hint==='alumno'?'alumno':remembered?.tipo||'';
    let updateGeneration=0;
    const dniField=document.getElementById('login-dni'),passwordField=document.getElementById('login-password');
    dniField?.setAttribute('enterkeyhint','next');passwordField?.setAttribute('enterkeyhint','go');
    dniField?.addEventListener('keydown',e=>{if(e.key==='Enter'&&passwordField&&!passwordField.value){e.preventDefault();passwordField.focus();}});
    // Saludo y usuario de la última cuenta de este celular (los trabajadores ya los precarga el login).
    const title=document.querySelector('.login__title');
    if(remembered&&!accountDni()){
      if(title&&remembered.nombre)title.textContent='Hola, '+remembered.nombre;
      if(dniField&&!dniField.value)dniField.value=remembered.usuario;
      // Celular compartido: se puede olvidar la última cuenta y entrar con otra.
      const other=document.createElement('button');other.type='button';other.className='login-switch';other.textContent=remembered.nombre?`¿No eres ${remembered.nombre}? Usar otra cuenta`:'Usar otra cuenta';
      other.addEventListener('click',()=>{forgetLastAccount();if(title)title.textContent='Hola de nuevo';if(dniField){dniField.value='';dniField.focus();}other.remove();update();});
      document.querySelector('.login__subtitle')?.after(other);
    }
    const showManual=open=>{wrapper.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.querySelector('span').textContent=open?'Ocultar opciones de acceso':'Elegir tipo de cuenta manualmente';if(open)select.focus({preventScroll:true});};
    toggle.addEventListener('click',()=>showManual(wrapper.hidden));
    if(select.value!=='automatico')showManual(true);
    const paintDetect=()=>{
      if(select.value==='automatico'){
        detect.classList.remove('is-manual');
        detect.innerHTML=`${icon('sparkle')}<span>Reconocemos tu cuenta automáticamente: alumno, trabajador o administración.</span>`;
      }else{
        detect.classList.add('is-manual');
        detect.innerHTML=`${icon('user')}<span>Ingresarás como <strong>${esc(select.options[select.selectedIndex]?.text||'')}</strong></span><button type="button" class="login-detect__reset">Detectar automáticamente</button>`;
        detect.querySelector('.login-detect__reset').addEventListener('click',()=>{try{sessionStorage.removeItem(MANUAL_KEY);}catch{}select.value='automatico';select.dispatchEvent(new Event('change'));showManual(false);dniField?.focus();});
      }
    };
    const update=({prefill=false}={})=>{
      const generic=['automatico','administracion'].includes(select.value);
      const label=form.querySelector('label[for=login-dni]');if(label)label.textContent=generic?'DNI o usuario':'DNI';
      if(dniField){dniField.type=generic?'text':'tel';dniField.maxLength=generic?100:8;dniField.inputMode=generic?'text':'numeric';dniField.placeholder=generic?'Tu DNI o usuario':'8 dígitos';if(generic)dniField.removeAttribute('pattern');else dniField.pattern='[0-9]{8}';dniField.autocapitalize='off';dniField.spellcheck=false;}
      const revision=++updateGeneration;
      wrapper.querySelector('p').hidden=select.value!=='alumno';
      const subtitle=document.querySelector('.login__subtitle');
      if(subtitle)subtitle.textContent=select.value==='alumno'?'Tu cuenta de intranet, según tu rol':select.value==='trabajador'?'Ingresa con tu DNI para marcar tu asistencia':select.value==='administracion'?'El servidor identificará tu cuenta y sus permisos':accountDni()?'Escribe tu contraseña para entrar. Funciona también sin Internet.':'Ingresa con tu DNI o usuario y tu contraseña.';
      paintDetect();
      const workerBio=document.getElementById('btn-login-biometric');if(workerBio)workerBio.hidden=!['automatico','trabajador'].includes(select.value)||!biometricEnabled();
      biometricButton.hidden=true;
      import('./student-biometric.js').then(bio=>{
        if(!biometricButton.isConnected||revision!==updateGeneration)return;
        const identity=bio.studentBiometricIdentity(),dni=dniField?.value.trim()||'';
        // En detección automática la huella del alumno también se ofrece, salvo que este celular
        // tenga la huella de un trabajador y la última cuenta usada no sea de alumno.
        const automaticOk=select.value==='automatico'&&(hintType==='alumno'||!biometricEnabled());
        const available=(select.value==='alumno'||automaticOk)&&bio.biometricStatus()==='available'&&bio.studentBiometricEnabled();
        biometricButton.hidden=!available;biometricButton.disabled=studentAccessPending||Boolean(dni&&identity?.dni!==dni);
        biometricButton.querySelector('.bio-login__sub').textContent=dni&&identity?.dni!==dni?'Usa contraseña para ingresar con otro DNI':'Tu cuenta de alumno · '+(identity?.dni||'');
        if(available&&prefill&&!dni&&dniField)dniField.value=identity.dni;
      }).catch(()=>{biometricButton.hidden=true;});
    };
    biometricButton.addEventListener('click',async()=>{
      if(studentAccessPending||!['alumno','automatico'].includes(select.value))return;studentAccessPending=true;biometricButton.disabled=true;select.disabled=true;const main=form.querySelector('[type="submit"]');main.disabled=true;const error=document.getElementById('login-error');if(error)error.hidden=true;
      const dni=dniField?.value.trim()||'';if(passwordField)passwordField.value='';
      if(dniField)dniField.disabled=true;if(passwordField)passwordField.disabled=true;
      biometricButton.setAttribute('aria-busy','true');biometricButton.querySelector('.bio-login__title').textContent='Verificando huella…';
      try{const bio=await import('./student-biometric.js');await bio.loginStudentBiometric({dni});const session=studentSession();if(session){rememberLastAccount({tipo:'alumno',usuario:session.dni||dni,nombre:session.nombre});announceDetectedAccount('alumno');}beginBoot();location.hash='#home';location.reload();}catch(e){if(error){error.hidden=false;error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;}}finally{studentAccessPending=false;main.disabled=false;select.disabled=false;if(dniField)dniField.disabled=false;if(passwordField){passwordField.disabled=false;passwordField.value='';}biometricButton.removeAttribute('aria-busy');biometricButton.querySelector('.bio-login__title').textContent='Ingresar con huella';update();}
    });
    select.addEventListener('change',()=>{const automatic=select.dataset.auto==='1';delete select.dataset.auto;if(!automatic){delete select.dataset.autoWorker;try{if(select.value==='automatico')sessionStorage.removeItem(MANUAL_KEY);else sessionStorage.setItem(MANUAL_KEY,select.value);}catch{}}update({prefill:true});});update({prefill:true});
    dniField?.addEventListener('input',()=>{form.querySelector('[data-account-choices]')?.remove();takeChoicePassword();update();});
    window.addEventListener('focus',()=>{if(form.isConnected)update();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&form.isConnected)update();});
  }
  // Varias cuentas con los mismos datos: tarjetas para elegir; con la contraseña aún en memoria se entra al tocar.
  function showAccountChoices(form,select,accounts){
    const choices=document.createElement('fieldset');choices.dataset.accountChoices='';choices.className='login-choices';
    const legend=document.createElement('legend');legend.textContent=choicePassword?'Encontramos varias cuentas con tus datos. ¿Con cuál quieres entrar?':'Elige tu cuenta y vuelve a ingresar la contraseña';choices.append(legend);
    for(const account of accounts||[]){
      let value=account.origen==='intranet'?'alumno':account.origen;
      if(![...select.options].some(option=>option.value===value)&&account.origen==='asistencia')value='administracion';
      const choice=document.createElement('button');choice.type='button';choice.className='login-choice';
      choice.innerHTML=`<span class="login-choice__icon">${icon(choiceIcons[account.origen]||'user')}</span><span class="login-choice__text"><strong>${esc(account.etiqueta)}</strong><small>${esc(account.origen==='intranet'?'Cuenta de intranet':ACCOUNT_LABELS[account.origen]||'Cuenta institucional')}</small></span>${icon('chevron-right')}`;
      choice.addEventListener('click',()=>{
        const password=takeChoicePassword();
        setAccountType(select,value);choices.remove();
        const field=document.getElementById('login-password');
        if(password&&field){field.value=password;form.requestSubmit();}else field?.focus();
      });
      choices.append(choice);
    }
    form.append(choices);
    choices.querySelector('button')?.focus({preventScroll:true});
    choices.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='login-form')return;
    const selected=document.getElementById('login-account-type');if(!selected||selected.value==='trabajador')return;
    if(selected.value==='automatico'&&!navigator.onLine&&accountDni()===document.getElementById('login-dni')?.value.trim()){setAccountType(selected,'trabajador');return;}
    event.preventDefault();event.stopImmediatePropagation();
    const button=event.target.querySelector('[type="submit"]'); if(button.disabled||studentAccessPending)return;studentAccessPending=true;
    const error=document.getElementById('login-error');
    const dni=document.getElementById('login-dni')?.value.trim()||'', password=document.getElementById('login-password')?.value||'';
    if(error)error.hidden=true;
    const text=button.querySelector('#btn-text'), spinner=button.querySelector('#btn-spinner');
    const originalText=text?.textContent;let delegateWorker=false,keepPassword=false,entering=false;
    const toggle=document.getElementById('login-role-toggle');
    button.disabled=true;selected.disabled=true;if(toggle)toggle.disabled=true;document.getElementById('login-dni').disabled=true;document.getElementById('login-password').disabled=true;if(text){text.hidden=false;text.textContent=selected.value==='automatico'?'Reconociendo tu cuenta…':'Verificando tu cuenta…';}if(spinner)spinner.hidden=false;
    button.classList.add('is-detecting');
    try {
      if(!dni||dni.length>100||password.length<6)throw new Error('Revisa tu DNI o usuario y tu contraseña.');
      let response;
      try{response=await unifiedLogin(dni,password,selected.value==='alumno'?'intranet':selected.value);}
      catch(e){
        // Servidor caído o sin el acceso unificado: un trabajador de 8 dígitos sigue entrando por su acceso
        // de siempre (incluido el ingreso sin conexión con la cuenta vinculada a este celular).
        const linked=dni===accountDni();
        if(selected.value==='automatico'&&/^[0-9]{8}$/.test(dni)&&((e.invalidResponse&&e.status===404)||(linked&&(e.offline||!e.status||e.status>=500)))){response={continuar_trabajador:true};}
        else throw e;
      }
      event.target.querySelector('[data-account-choices]')?.remove();
      if(response.seleccionar_cuenta){keepChoicePassword(password);keepPassword=true;showAccountChoices(event.target,selected,response.cuentas);return;}
      if(response.continuar_trabajador){setAccountType(selected,'trabajador');delegateWorker=true;return;}
      if(response.tipo==='alumno')acceptStudentLogin(response,dni);
      else if(response.tipo==='personal')await storeStaffSession(response);
      else throw new Error('El servidor no devolvió un rol válido.');
      const type=detectedType(response);
      rememberLastAccount({tipo:type,usuario:dni,nombre:type==='alumno'?response.alumno?.nombre:response.identidad?.nombre,rol:response.identidad?.rol});
      announceDetectedAccount(type,response.identidad?.rol);
      entering=true;if(text)text.textContent='Entrando como '+(ACCOUNT_LABELS[type]||'tu cuenta')+'…';
      document.getElementById('login-password').value='';beginBoot();location.hash='#home';location.reload();
    }catch(e){if(error){error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;error.hidden=false;}}
    finally{
      studentAccessPending=false;button.classList.remove('is-detecting');
      if(!entering){button.disabled=false;selected.disabled=false;if(toggle)toggle.disabled=false;document.getElementById('login-dni').disabled=false;document.getElementById('login-password').disabled=false;if(text)text.textContent=originalText;if(spinner)spinner.hidden=true;}
      const passwordField=document.getElementById('login-password');if(passwordField&&!delegateWorker&&!entering)passwordField.value='';
      if(keepPassword)document.querySelector('[data-account-choices] button')?.focus({preventScroll:true});
      if(delegateWorker)event.target.requestSubmit();
    }
  },true);
  const stage=document.getElementById('app-view');
  if(stage)new MutationObserver(enhanceLogin).observe(stage,{childList:true,subtree:true});
  import('./app.js').then(enhanceLogin);
}
}
const boot=()=>prepareAppRuntime().then(startApp);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
