import { getThemePreference, setThemePreference } from './theme.js';
import { studentRequest } from './student-api.js';
import { biometricStatus, studentBiometricEnabled, enrollStudentBiometric, forgetStudentBiometric } from './student-biometric.js';
import { icon, rowIcon } from './icons.js';
import { enhancePasswordFields, setActiveSegment, ICON_CHEVRON } from './utils.js';
import { openSheet, closeSheet, dismissSheet, dismissTopSheet, showActionSheet } from './sheet.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,activeSheet=null,themeListener=null;
export const accountBusy=()=>busy;
// Las hojas de la app se mueven a body al abrirse, fuera de la vista de Perfil.
export const editingAccount=()=>busy||Boolean(activeSheet);
export const handleStudentSettingsBack=()=>busy||dismissTopSheet();
function field(title,value,name,color){return `<div class="list-row">${rowIcon(name,color)}<span class="list-row__main">${title}</span><span class="list-row__end sa-field">${esc(value||'Sin registrar')}</span></div>`;}

export function studentProfileDataMarkup(p){
  return `<div class="list-header">Mis datos</div><div class="ios-card ios-card--flush list-group--icons">
    <button type="button" id="student-edit-dni" class="list-row" aria-haspopup="dialog">${rowIcon('idcard','blue')}<span class="list-row__main"><span>DNI</span><span class="list-row__sub">Requiere contraseña</span></span><span class="list-row__end"><span class="tabular">${esc(p.dni||'Agregar')}</span>${ICON_CHEVRON}</span></button>
    <button type="button" id="student-edit-email" class="list-row" aria-haspopup="dialog">${rowIcon('mail','indigo')}<span class="list-row__main">Correo</span><span class="list-row__end"><span class="sa-field">${esc(p.email||'Agregar')}</span>${ICON_CHEVRON}</span></button>
    <button type="button" id="student-edit-phone" class="list-row" aria-haspopup="dialog">${rowIcon('phone','green')}<span class="list-row__main">Teléfono</span><span class="list-row__end"><span id="student-phone-display" class="tabular">${esc(p.telefono||'Agregar')}</span>${ICON_CHEVRON}</span></button>
    <button type="button" id="student-change-password" class="list-row" aria-haspopup="dialog">${rowIcon('key','gray')}<span class="list-row__main">Cambiar contraseña</span><span class="list-row__end">${ICON_CHEVRON}</span></button>
  </div>`;
}
function passwordField(id,label,autocomplete='current-password'){
  return `<div class="ios-input-group"><label class="ios-label" for="${id}">${label}</label><input class="ios-input" id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" required maxlength="72" ${autocomplete==='new-password'?'minlength="10"':''}></div>`;
}
function sheet(key,title,action,body){
  const form=`student-${key}-form`;
  return `<div id="student-${key}-sheet" class="sheet-backdrop" data-student-sheet hidden><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="student-${key}-title" tabindex="-1"><div class="sheet__grabber"></div><div class="sheet__nav"><button type="button" class="nav-btn nav-btn--text" data-student-cancel>Cancelar</button><h3 class="sheet__nav-title" id="student-${key}-title">${title}</h3><button type="submit" form="${form}" class="nav-btn nav-btn--text nav-btn--strong" disabled>${action}</button></div><form id="${form}">${body}<p class="sa-form-status" role="status" aria-live="polite"></p></form></div></div>`;
}
export function studentSettingsMarkup(p,notice=''){
  const status=biometricStatus(),enabled=studentBiometricEnabled();
  const hint=enabled?'Entra sin escribir tu contraseña':status==='available'?'Activar en este teléfono':status==='none_enrolled'?'Registra una huella en los ajustes del teléfono':'Disponible en la app Android compatible';
  return `<section id="student-settings" aria-label="Apariencia y seguridad">
    <p id="student-settings-notice" role="status" class="sa-form-notice" ${notice?'':'hidden'}>${esc(notice)}</p>
    <div class="list-header">Seguridad</div><div class="ios-card ios-card--flush list-group--icons"><label class="list-row" for="student-bio-toggle">${rowIcon('fingerprint','green')}<span class="list-row__main"><span>Ingresar con huella</span><span class="list-row__sub" id="student-bio-hint">${hint}</span></span><input id="student-bio-toggle" class="ios-switch" type="checkbox" role="switch" aria-describedby="student-bio-hint" ${enabled?'checked':''} ${status!=='available'&&!enabled?'disabled':''}></label></div>
    <div class="list-header">Apariencia</div><div class="ios-card theme-card"><div class="theme-card__head">${rowIcon('moon','indigo')}<span class="list-row__main"><span>Tema</span><span id="student-theme-hint" class="list-row__sub"></span></span></div><div class="segmented" role="radiogroup" aria-label="Tema de la app">${[['auto','Automático',''],['light','Claro','sun'],['dark','Oscuro','moon']].map(([value,text,symbol])=>`<button type="button" class="segmented__item" data-student-theme="${value}" role="radio" aria-checked="false">${symbol?icon(symbol):''}<span>${text}</span></button>`).join('')}</div></div>
  </section>
  ${sheet('phone','Teléfono','Guardar',`<div class="ios-input-group"><label class="ios-label" for="student-phone">Número de teléfono</label><input class="ios-input" id="student-phone" name="telefono" type="tel" autocomplete="tel" inputmode="tel" required maxlength="25" value="${esc(p.telefono)}" placeholder="Ej. +51 999 999 999"></div><p class="sheet-hint">Se actualiza en tu cuenta de intranet.</p>`)}
  ${sheet('email','Correo','Guardar',`<div class="ios-input-group"><label class="ios-label" for="student-email">Correo electrónico</label><input class="ios-input" id="student-email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="255" value="${esc(p.email)}" placeholder="tucorreo@ejemplo.com"></div><p class="sheet-hint">Usaremos este correo para recuperar tu acceso a la intranet.</p>`)}
  ${sheet('dni','DNI','Guardar',`<div class="ios-input-group"><label class="ios-label" for="student-dni">Nuevo DNI</label><input class="ios-input" id="student-dni" name="dni" type="text" inputmode="numeric" autocomplete="off" required maxlength="8" pattern="[0-9]{8}" title="8 dígitos" value="${esc(p.dni)}"></div>${passwordField('dni-password','Contraseña actual')}<p class="sheet-hint">Tu DNI es tu usuario de ingreso a la app y a la intranet. Por seguridad, solo este cambio pide tu contraseña.</p>`)}
  ${sheet('password','Contraseña','Guardar',`${passwordField('change-current','Contraseña actual')}${passwordField('change-new','Nueva contraseña','new-password')}${passwordField('change-confirm','Confirmar nueva contraseña','new-password')}<p class="sheet-hint">Usa al menos 10 caracteres. El cambio se aplica a la intranet y cierra tus sesiones de esta app.</p>`)}
  ${sheet('bio','Ingreso con huella','Activar',`<p class="sheet-hint">Escribe tu contraseña una vez. Quedará cifrada en este teléfono y se usará al autenticarte con la huella.</p>${passwordField('bio-current','Contraseña actual')}`)}`;
}

export function bindStudentSettings(root,{onProfile,onDni,onPassword,onBiometric,onIdle}){
  if(themeListener){window.removeEventListener('theme:change',themeListener);themeListener=null;}
  if(!root.querySelector('#student-settings'))return;
  const themes=[...root.querySelectorAll('[data-student-theme]')];
  const syncTheme=()=>{
    const pref=getThemePreference(),selected=themes.find(button=>button.dataset.studentTheme===pref);
    setActiveSegment(themes,selected);
    themes.forEach(button=>{const checked=button===selected;button.setAttribute('aria-checked',String(checked));button.removeAttribute('aria-selected');button.tabIndex=checked?0:-1;});
    root.querySelector('#student-theme-hint').textContent={auto:'Sigue el ajuste de tu teléfono',light:'Tema claro',dark:'Tema oscuro'}[pref];
  };
  themes.forEach((button,index)=>{
    button.addEventListener('click',()=>{setThemePreference(button.dataset.studentTheme);});
    button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;themes[next].click();themes[next].focus();});
  });
  themeListener=syncTheme;window.addEventListener('theme:change',themeListener);syncTheme();
  enhancePasswordFields(root);
  const toggle=root.querySelector('#student-bio-toggle');
  const modals=Object.fromEntries(['phone','email','dni','password','bio'].map(key=>[key,root.querySelector(`#student-${key}-sheet`)]));
  function clearSecrets(form){
    form.querySelectorAll('input[autocomplete$="password"]').forEach(input=>{input.value='';input.type='password';});
    form.querySelectorAll('.input-action').forEach(button=>{button.innerHTML=icon('eye');button.setAttribute('aria-label','Mostrar contraseña');});
  }
  function open(key){
    if(busy||activeSheet)return;
    const modal=modals[key],form=modal.querySelector('form');form.reset();clearSecrets(form);form.querySelector('.sa-form-status').textContent='';
    const original=form.querySelector('input[type="tel"],input[type="email"],input[name="dni"]')?.value||'';
    const save=modal.querySelector('[type="submit"]'),cancel=modal.querySelector('[data-student-cancel]');
    const update=()=>{save.disabled=busy||!form.checkValidity()||(['phone','email','dni'].includes(key)&&form.querySelector('input[type="tel"],input[type="email"],input[name="dni"]').value.trim()===original.trim());};
    form.oninput=update;update();activeSheet=modal;
    const snapshot=()=>[...form.querySelectorAll('input')].map(input=>input.value).join('\u0001');
    const initial=snapshot();
    openSheet(modal,{focus:form.querySelector('input'),canDismiss:async()=>{if(busy)return false;if(snapshot()===initial)return true;const choice=await showActionSheet({actions:[{label:'Descartar cambios',value:'discard',style:'destructive'}],cancelLabel:'Seguir editando'});return choice==='discard';},onClose:()=>{form.reset();clearSecrets(form);cancel.disabled=false;activeSheet=null;toggle.checked=studentBiometricEnabled();onIdle?.();}});
  }
  root.querySelector('#student-edit-phone')?.addEventListener('click',()=>open('phone'));
  root.querySelector('#student-edit-email')?.addEventListener('click',()=>open('email'));
  root.querySelector('#student-edit-dni')?.addEventListener('click',()=>open('dni'));
  root.querySelector('#student-change-password')?.addEventListener('click',()=>open('password'));
  Object.values(modals).forEach(modal=>modal.querySelector('[data-student-cancel]').addEventListener('click',()=>{if(!busy)dismissSheet(modal);}));
  toggle.addEventListener('change',()=>{if(busy){toggle.checked=studentBiometricEnabled();return;}if(!toggle.checked){forgetStudentBiometric();onBiometric('Huella desactivada en este teléfono.');}else{toggle.checked=false;open('bio');}});

  async function submit(form,work,success){
    if(busy)return;const modal=form.closest('.sheet-backdrop'),values=new FormData(form);busy=true;
    const button=modal.querySelector('[type="submit"]'),cancel=modal.querySelector('[data-student-cancel]'),text=button.textContent,status=form.querySelector('.sa-form-status');
    status.setAttribute('role','status');status.textContent='Procesando…';button.disabled=true;cancel.disabled=true;button.textContent=form.id==='student-bio-form'?'Activando…':'Guardando…';
    form.querySelectorAll('input,button').forEach(control=>control.disabled=true);
    try{const result=await work(values);clearSecrets(form);await closeSheet(modal);success(result);}
    catch(error){status.setAttribute('role','alert');status.textContent=error.name==='AbortError'?'La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.':error.message;toggle.checked=studentBiometricEnabled();}
    finally{clearSecrets(form);busy=false;cancel.disabled=false;button.textContent=text;form.querySelectorAll('input,button').forEach(control=>control.disabled=false);form.oninput?.();}
  }
  const phone=modals.phone.querySelector('form');phone.addEventListener('submit',event=>{event.preventDefault();submit(phone,async values=>{const value=String(values.get('telefono')).trim(),digits=value.replace(/\D/g,'');if(digits.length<6||digits.length>15)throw new Error('El teléfono debe contener de 6 a 15 dígitos.');return studentRequest('actualizar_perfil',{telefono:value});},result=>onProfile(result,'Teléfono actualizado correctamente'));});
  const email=modals.email.querySelector('form');email.addEventListener('submit',event=>{event.preventDefault();submit(email,async values=>{const value=String(values.get('email')).trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Ingresa un correo válido.');return studentRequest('actualizar_perfil',{email:value});},result=>onProfile(result,'Correo actualizado correctamente'));});
  const dni=modals.dni.querySelector('form');dni.addEventListener('submit',event=>{event.preventDefault();submit(dni,async values=>{const value=String(values.get('dni')).trim();if(!/^[0-9]{8}$/.test(value))throw new Error('El DNI debe tener exactamente 8 dígitos.');return studentRequest('actualizar_dni',{dni_nuevo:value,password_actual:values.get('dni-password')});},onDni);});
  const password=modals.password.querySelector('form');password.addEventListener('submit',event=>{event.preventDefault();submit(password,async values=>{const next=String(values.get('change-new'));if(next!==values.get('change-confirm'))throw new Error('Las contraseñas nuevas no coinciden.');if([...next].length<10||new TextEncoder().encode(next).length>72)throw new Error('Usa al menos 10 caracteres y como máximo 72 bytes.');return studentRequest('cambiar_password',{password_actual:values.get('change-current'),password_nueva:next});},()=>{forgetStudentBiometric();onPassword();});});
  const bio=modals.bio.querySelector('form');bio.addEventListener('submit',event=>{event.preventDefault();submit(bio,values=>enrollStudentBiometric(String(values.get('bio-current'))),()=>onBiometric('Huella activada para esta cuenta y servidor.'));});
}
