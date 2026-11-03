// El APK ya contiene sus módulos. Su API usa el servidor elegido, pero sus archivos
// de interfaz no deben ser reemplazados por una web de otra versión.
export function isBundledAndroid(){
  return location.hostname==='appassets.androidplatform.net'&&typeof window.AndroidNet?.getServer==='function';
}
export async function prepareAppRuntime(){
  if(!isBundledAndroid())return;
  const work=async()=>{
    if('serviceWorker' in navigator){
      const scope=new URL('../',import.meta.url);
      const registrations=await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.filter(reg=>{
        const url=new URL(reg.scope);return url.origin===scope.origin&&url.pathname===scope.pathname;
      }).map(reg=>reg.unregister()));
    }
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.filter(name=>name.startsWith('asistencia-static-')||name.startsWith('asistencia-dynamic-')).map(name=>caches.delete(name)));
    }
  };
  let timer;
  try{await Promise.race([work(),new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}
  catch{/* El paquete nativo sigue disponible incluso si WebView no permite esta limpieza. */}
  finally{clearTimeout(timer);}
}
