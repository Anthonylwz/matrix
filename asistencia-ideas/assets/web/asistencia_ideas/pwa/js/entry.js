import { staffSession, unifiedLogin, storeStaffSession } from './staff-api.js';
import { accountDni } from './auth.js';
import { studentSession, acceptStudentLogin } from './student-api.js';
import { useProfileServerControls } from './student-server.js';
import { icon } from './icons.js';
import { biometricEnabled } from './biometric.js';
import { isBundledAndroid, prepareAppRuntime } from './app-runtime.js';
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
  // Se añade a la pantalla existente sin reemplazar el acceso ni las funciones de trabajadores.
  function enhanceLogin() {
    const form=document.getElementById('login-form');
    if(!form||form.querySelector('#login-account-type'))return;
    const wrapper=document.createElement('div'); wrapper.className='ios-input-group';
    wrapper.innerHTML='<label class="ios-label" for="login-account-type">Tipo de cuenta</label><select id="login-account-type" class="ios-input"><option value="automatico">Detectar mi cuenta</option><option value="trabajador">Trabajador · Asistencia</option><option value="alumno">Mi cuenta de intranet</option><option value="administracion">Administración · Asistencia</option></select><p id="student-login-hint" class="student-login-hint" hidden>Usa el mismo DNI y contraseña con los que ingresas a la intranet.</p>';
    form.prepend(wrapper);
    const biometricButton=document.createElement('button');biometricButton.type='button';biometricButton.id='student-login-biometric';biometricButton.className='bio-login student-bio-login';biometricButton.hidden=true;
    biometricButton.innerHTML=`<span class="bio-login__icon">${icon('fingerprint')}</span><span class="bio-login__text"><span class="bio-login__title">Ingresar con huella</span><span class="bio-login__sub">Tu cuenta de alumno</span></span>`;
    form.closest('.login__card').before(biometricButton);
    try{const notice=sessionStorage.getItem('ideas-student-login-notice');if(notice){const message=document.createElement('p');message.className='student-login-hint';message.setAttribute('role','status');message.textContent=notice;wrapper.append(message);sessionStorage.removeItem('ideas-student-login-notice');}}catch{}
    const select=wrapper.querySelector('select');
    select.value='automatico';
    try { const saved=sessionStorage.getItem('ideas-login-type')||localStorage.getItem('ideas-account-preference');if(['alumno','trabajador','automatico','administracion'].includes(saved))select.value=saved; } catch {}
    let updateGeneration=0;
    const dniField=document.getElementById('login-dni'),passwordField=document.getElementById('login-password');
    const update=({prefill=false}={})=>{
      const generic=['automatico','administracion'].includes(select.value);
      const label=form.querySelector('label[for=login-dni]');if(label)label.textContent=generic?'DNI o usuario':'DNI';
      if(dniField){dniField.type=generic?'text':'tel';dniField.maxLength=generic?100:8;dniField.inputMode=generic?'text':'numeric';dniField.placeholder=generic?'Tu DNI o usuario':'8 dígitos';if(generic)dniField.removeAttribute('pattern');else dniField.pattern='[0-9]{8}';}
      const revision=++updateGeneration;
      wrapper.querySelector('p').hidden=select.value!=='alumno';
      const subtitle=document.querySelector('.login__subtitle');if(subtitle)subtitle.textContent=select.value==='alumno'?'Tu cuenta de intranet, según tu rol':(select.value==='trabajador'?'Ingresa con tu DNI para marcar tu asistencia':'El servidor identificará tu cuenta y sus permisos');
      const workerBio=document.getElementById('btn-login-biometric');if(workerBio)workerBio.hidden=!['automatico','trabajador'].includes(select.value)||!biometricEnabled();
      biometricButton.hidden=true;
      import('./student-biometric.js').then(bio=>{
        if(!biometricButton.isConnected||revision!==updateGeneration)return;
        const identity=bio.studentBiometricIdentity(),dni=dniField?.value.trim()||'';
        const available=select.value==='alumno'&&bio.biometricStatus()==='available'&&bio.studentBiometricEnabled();
        biometricButton.hidden=!available;biometricButton.disabled=studentAccessPending||Boolean(dni&&identity?.dni!==dni);
        biometricButton.querySelector('.bio-login__sub').textContent=dni&&identity?.dni!==dni?'Usa contraseña para ingresar con otro DNI':'Tu cuenta de alumno · '+(identity?.dni||'');
        if(available&&prefill&&!dni&&dniField)dniField.value=identity.dni;
      }).catch(()=>{biometricButton.hidden=true;});
    };
    biometricButton.addEventListener('click',async()=>{
      if(studentAccessPending||select.value!=='alumno')return;studentAccessPending=true;biometricButton.disabled=true;select.disabled=true;const main=form.querySelector('[type="submit"]');main.disabled=true;const error=document.getElementById('login-error');if(error)error.hidden=true;
      const dni=dniField?.value.trim()||'';if(passwordField)passwordField.value='';
      if(dniField)dniField.disabled=true;if(passwordField)passwordField.disabled=true;
      biometricButton.setAttribute('aria-busy','true');biometricButton.querySelector('.bio-login__title').textContent='Verificando huella…';
      try{const bio=await import('./student-biometric.js');await bio.loginStudentBiometric({dni});beginBoot();location.hash='#home';location.reload();}catch(e){if(error){error.hidden=false;error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;}}finally{studentAccessPending=false;main.disabled=false;select.disabled=false;if(dniField)dniField.disabled=false;if(passwordField){passwordField.disabled=false;passwordField.value='';}biometricButton.removeAttribute('aria-busy');biometricButton.querySelector('.bio-login__title').textContent='Ingresar con huella';update();}
    });
    select.addEventListener('change',()=>{try{sessionStorage.setItem('ideas-login-type',select.value);localStorage.setItem('ideas-account-preference',select.value);}catch{}update({prefill:true});});update({prefill:true});
    dniField?.addEventListener('input',update);
    window.addEventListener('focus',()=>{if(form.isConnected)update();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&form.isConnected)update();});
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='login-form')return;
    const selected=document.getElementById('login-account-type');if(!selected||selected.value==='trabajador')return;
    if(selected.value==='automatico'&&!navigator.onLine&&accountDni()===document.getElementById('login-dni')?.value.trim()){selected.value='trabajador';return;}
    event.preventDefault();event.stopImmediatePropagation();
    const button=event.target.querySelector('[type="submit"]'); if(button.disabled||studentAccessPending)return;studentAccessPending=true;
    const error=document.getElementById('login-error');
    const dni=document.getElementById('login-dni')?.value.trim()||'', password=document.getElementById('login-password')?.value||'';
    if(error)error.hidden=true;
    const text=button.querySelector('#btn-text'), spinner=button.querySelector('#btn-spinner');
    const originalText=text?.textContent;let delegateWorker=false;
    button.disabled=true;selected.disabled=true;document.getElementById('login-dni').disabled=true;document.getElementById('login-password').disabled=true;if(text)text.textContent='Verificando tu cuenta…';if(spinner)spinner.hidden=false;
    try {
      if(!dni||dni.length>100||password.length<6)throw new Error('Revisa tu DNI o usuario y tu contraseña.');
      const response=await unifiedLogin(dni,password,selected.value==='alumno'?'intranet':selected.value);
      event.target.querySelector('[data-account-choices]')?.remove();
      if(response.seleccionar_cuenta){
        const choices=document.createElement('fieldset');choices.dataset.accountChoices='';const legend=document.createElement('legend');legend.textContent='Elige tu cuenta y vuelve a ingresar la contraseña';choices.append(legend);
        for(const account of response.cuentas||[]){const choice=document.createElement('button');choice.type='button';choice.className='ios-btn ios-btn-secondary';choice.textContent=account.etiqueta;choice.addEventListener('click',()=>{selected.value=account.origen==='intranet'?'alumno':account.origen;selected.dispatchEvent(new Event('change'));choices.remove();document.getElementById('login-password')?.focus();});choices.append(choice);}event.target.append(choices);return;
      }
      if(response.continuar_trabajador){selected.value='trabajador';selected.dispatchEvent(new Event('change'));delegateWorker=true;return;}
      if(response.tipo==='alumno')acceptStudentLogin(response,dni);
      else if(response.tipo==='personal')await storeStaffSession(response);
      else throw new Error('El servidor no devolvió un rol válido.');
      document.getElementById('login-password').value='';beginBoot();location.hash='#home';location.reload();
    }catch(e){if(error){error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;error.hidden=false;}}
    finally{studentAccessPending=false;button.disabled=false;selected.disabled=false;document.getElementById('login-dni').disabled=false;document.getElementById('login-password').disabled=false;if(text)text.textContent=originalText;if(spinner)spinner.hidden=true;const passwordField=document.getElementById('login-password');if(passwordField&&!delegateWorker)passwordField.value='';if(delegateWorker)event.target.requestSubmit();}
  },true);
  const stage=document.getElementById('app-view');
  if(stage)new MutationObserver(enhanceLogin).observe(stage,{childList:true,subtree:true});
  import('./app.js').then(enhanceLogin);
}
}
const boot=()=>prepareAppRuntime().then(startApp);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
