// El botón nativo de recuperación queda oculto en login y dentro de la app.
// La configuración se concentra en la fila Servidor de Perfil.
// Esta señal es de presentación: no registra una sesión ni una identidad de trabajador.
export function useProfileServerControls(){
  try{if(typeof window.AndroidNet?.setLoginServerControlsVisible!=='function')return false;window.AndroidNet.setLoginServerControlsVisible(true);return true;}catch{return false;}
}
export function studentServerInfo(){
  const bridge=window.AndroidNet;
  if(typeof bridge?.getServer!=='function'||typeof bridge?.openServerSettings!=='function')return null;
  try{const value=bridge.getServer();if(!value)return {label:'Sin configurar'};const url=new URL(value);return {label:url.origin+url.pathname.replace(/\/$/,'')};}catch{return {label:'Revisar dirección'};}
}
export function openStudentServerSettings(){
  if(!studentServerInfo())throw new Error('Esta opción está disponible en la app Android.');
  window.AndroidNet.openServerSettings();
}
