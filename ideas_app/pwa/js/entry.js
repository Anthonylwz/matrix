import { staffSession, unifiedLogin, storeStaffSession } from './staff-api.js';
import { accountDni } from './auth.js';
import { studentSession, acceptStudentLogin } from './student-api.js';
import { useProfileServerControls } from './student-server.js';
import { icon } from './icons.js';
import { biometricEnabled, biometricOwner } from './biometric.js';
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
let studentAccessPending=false,chosenAccount=null;
if(staffSession()){
  import('./staff-app.js').then(module=>{const ready=module.initStaffApp();requestAnimationFrame(()=>requestAnimationFrame(endBoot));return ready;}).then(endBoot).catch(()=>{document.getElementById('app-view').textContent='No se pudo cargar el panel. Cierra y vuelve a abrir la app.';endBoot();});
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
    const select=document.createElement('input');select.type='hidden';select.id='login-account-type';select.value='automatico';form.prepend(select);
    // Las preferencias de versiones anteriores nunca deciden qué cuenta autenticar.
    try{sessionStorage.removeItem('ideas-login-type');localStorage.removeItem('ideas-account-preference');}catch{}
    const biometricButton=document.createElement('button');biometricButton.type='button';biometricButton.id='student-login-biometric';biometricButton.className='bio-login student-bio-login';biometricButton.hidden=true;
    biometricButton.innerHTML=`<span class="bio-login__icon">${icon('fingerprint')}</span><span class="bio-login__text"><span class="bio-login__title">Ingresar con huella</span><span class="bio-login__sub">Continúa con tu huella</span></span>`;
    form.closest('.login__card').before(biometricButton);
    try{const notice=sessionStorage.getItem('ideas-student-login-notice');if(notice){const message=document.createElement('p');message.className='student-login-hint';message.setAttribute('role','status');message.textContent=notice;form.prepend(message);sessionStorage.removeItem('ideas-student-login-notice');}}catch{}
    let updateGeneration=0;
    const dniField=document.getElementById('login-dni'),passwordField=document.getElementById('login-password');
    const update=({prefill=false}={})=>{
      const label=form.querySelector('label[for=login-dni]');if(label)label.textContent='DNI o usuario';
      if(dniField){dniField.type='text';dniField.maxLength=100;dniField.inputMode='text';dniField.placeholder='Tu DNI o usuario';dniField.removeAttribute('pattern');}
      const revision=++updateGeneration,pending=studentAccessPending||Boolean(form.querySelector('[type="submit"]')?.disabled);
      const subtitle=document.querySelector('.login__subtitle');if(subtitle)subtitle.textContent='Ingresa con tu cuenta de IDEAS';
      const workerBio=document.getElementById('btn-login-biometric'),owner=biometricOwner(),workerAvailable=biometricEnabled();
      // Resolver ambos vínculos antes de prellenar evita que una bóveda cambie la identidad de la otra.
      if(workerBio)workerBio.hidden=true;biometricButton.hidden=true;
      const renderBiometric=(bio=null)=>{
        if(!biometricButton.isConnected||revision!==updateGeneration)return;
        const identity=bio?.studentBiometricIdentity(),studentAvailable=Boolean(identity&&bio.biometricStatus()==='available'&&bio.studentBiometricEnabled());
        let dni=dniField?.value.trim()||'';
        const identities=new Set([workerAvailable?owner?.dni:null,studentAvailable?identity.dni:null].filter(Boolean));
        if(prefill&&!dni&&dniField&&identities.size===1){dni=[...identities][0];dniField.value=dni;}
        const both=workerAvailable&&studentAvailable;
        if(workerBio){workerBio.hidden=!workerAvailable||Boolean(dni&&owner?.dni!==dni);workerBio.disabled=pending;const detail=workerBio.querySelector('.bio-login__sub');if(detail&&owner?.dni)detail.textContent=(both?'Trabajo · DNI ':'Vinculada al DNI ')+owner.dni;}
        biometricButton.hidden=!studentAvailable||Boolean(dni&&identity?.dni!==dni);biometricButton.disabled=pending;
        biometricButton.querySelector('.bio-login__sub').textContent=(both?'Estudios · DNI ':'Vinculada al DNI ')+(identity?.dni||'');
      };
      import('./student-biometric.js').then(renderBiometric).catch(()=>renderBiometric());
    };
    biometricButton.addEventListener('click',async()=>{
      const main=form.querySelector('[type="submit"]');if(studentAccessPending||main.disabled||biometricButton.disabled)return;
      studentAccessPending=true;chosenAccount=null;select.value='alumno';biometricButton.disabled=true;select.disabled=true;main.disabled=true;const workerBio=document.getElementById('btn-login-biometric');if(workerBio)workerBio.disabled=true;const error=document.getElementById('login-error');if(error)error.hidden=true;
      const dni=dniField?.value.trim()||'';if(passwordField)passwordField.value='';
      if(dniField)dniField.disabled=true;if(passwordField)passwordField.disabled=true;
      biometricButton.setAttribute('aria-busy','true');biometricButton.querySelector('.bio-login__title').textContent='Verificando huella…';
      try{const bio=await import('./student-biometric.js');await bio.loginStudentBiometric({dni});beginBoot();location.hash='#home';location.reload();}catch(e){if(error){error.hidden=false;error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;}}finally{studentAccessPending=false;main.disabled=false;select.disabled=false;select.value='automatico';if(dniField)dniField.disabled=false;if(passwordField){passwordField.disabled=false;passwordField.value='';}biometricButton.removeAttribute('aria-busy');biometricButton.querySelector('.bio-login__title').textContent='Ingresar con huella';update();}
    });
    select.addEventListener('change',()=>update());update({prefill:true});
    dniField?.addEventListener('input',()=>{chosenAccount=null;select.value='automatico';form.querySelector('[data-account-choices]')?.remove();});
    dniField?.addEventListener('input',update);
    window.addEventListener('focus',()=>{if(form.isConnected)update();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&form.isConnected)update();});
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='login-form')return;
    const selected=document.getElementById('login-account-type');if(!selected)return;
    // El desvío a trabajador dura un solo envío; el siguiente acceso vuelve a detectarse.
    if(selected.value==='trabajador'){chosenAccount=null;queueMicrotask(()=>{if(selected.isConnected)selected.value='automatico';});return;}
    if(selected.value==='automatico'&&!navigator.onLine&&accountDni()===document.getElementById('login-dni')?.value.trim()){selected.value='trabajador';queueMicrotask(()=>{if(selected.isConnected)selected.value='automatico';});return;}
    event.preventDefault();event.stopImmediatePropagation();
    const button=event.target.querySelector('[type="submit"]'); if(button.disabled||studentAccessPending)return;studentAccessPending=true;
    const error=document.getElementById('login-error');
    const dni=document.getElementById('login-dni')?.value.trim()||'', password=document.getElementById('login-password')?.value||'';
    if(error)error.hidden=true;
    const origin=chosenAccount?.identity===dni?chosenAccount.origin:'automatico';chosenAccount=null;
    event.target.querySelector('[data-account-choices]')?.remove();
    const text=button.querySelector('#btn-text'), spinner=button.querySelector('#btn-spinner');
    const originalText=text?.textContent;let delegateWorker=false;
    button.disabled=true;selected.disabled=true;document.getElementById('login-dni').disabled=true;document.getElementById('login-password').disabled=true;if(text)text.textContent='Ingresando…';if(spinner)spinner.hidden=false;
    try {
      if(!dni||dni.length>100||password.length<6)throw new Error('Revisa tu DNI o usuario y tu contraseña.');
      const response=await unifiedLogin(dni,password,origin);
      event.target.querySelector('[data-account-choices]')?.remove();
      if(response.seleccionar_cuenta){
        const accounts=[...new Map((Array.isArray(response.cuentas)?response.cuentas:[]).filter(a=>['trabajador','administracion','intranet'].includes(a?.origen)).map(a=>[a.origen,a])).values()];
        if(accounts.length<2)throw new Error('No se pudo confirmar tu cuenta. Inténtalo nuevamente.');
        const choices=document.createElement('fieldset');choices.dataset.accountChoices='';const legend=document.createElement('legend');legend.textContent='Encontramos dos accesos para ti. Elige uno y confirma tu contraseña';choices.append(legend);
        for(const account of accounts){const choice=document.createElement('button');choice.type='button';choice.className='ios-btn ios-btn-secondary';choice.textContent=account.etiqueta;choice.addEventListener('click',()=>{chosenAccount={identity:dni,origin:account.origen};selected.value=account.origen==='intranet'?'alumno':account.origen;selected.dispatchEvent(new Event('change'));choices.remove();document.getElementById('login-password')?.focus();});choices.append(choice);}event.target.append(choices);return;
      }
      if(response.continuar_trabajador){selected.value='trabajador';selected.dispatchEvent(new Event('change'));delegateWorker=true;return;}
      if(response.tipo==='alumno')acceptStudentLogin(response,dni);
      else if(response.tipo==='personal')await storeStaffSession(response);
      else throw new Error('El servidor no devolvió un rol válido.');
      document.getElementById('login-password').value='';beginBoot();location.hash='#home';location.reload();
    }catch(e){if(error){error.textContent=e.name==='AbortError'?'La conexión tardó demasiado. Inténtalo nuevamente.':e.message;error.hidden=false;}}
    finally{studentAccessPending=false;button.disabled=false;selected.disabled=false;document.getElementById('login-dni').disabled=false;document.getElementById('login-password').disabled=false;if(text)text.textContent=originalText;if(spinner)spinner.hidden=true;const passwordField=document.getElementById('login-password');if(passwordField&&!delegateWorker)passwordField.value='';if(!delegateWorker)selected.value='automatico';if(delegateWorker)event.target.requestSubmit();}
  },true);
  const stage=document.getElementById('app-view');
  if(stage)new MutationObserver(enhanceLogin).observe(stage,{childList:true,subtree:true});
  import('./app.js').then(enhanceLogin);
}
}
const boot=()=>prepareAppRuntime().then(startApp);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
