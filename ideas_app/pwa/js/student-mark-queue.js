// Cada cuenta y servidor conservan sus marcas, incluso si otra cuenta inicia sesión.
export function createMarkQueue(readSession, storage) {
  const legacy='ideas-student-marks', prefix=legacy+'-v2:', maxAge=48*3600*1000;
  const owner=()=>{const s=readSession();return s?{alumno_id:s.alumno_id,server_key:s.server_key}:null;};
  const same=(a,b)=>a&&b&&Number(a.alumno_id)===Number(b.alumno_id)&&a.server_key===b.server_key;
  const key=o=>prefix+encodeURIComponent(o.server_key)+':'+o.alumno_id;
  const valid=(q,o)=>same(q,o)&&Array.isArray(q.items)?q.items.filter(i=>i&&typeof i.marca_id==='string'&&i.payload&&typeof i.capturado_en==='string'&&Number.isFinite(i.guardada)):[];
  function read(o=owner()){
    if(!o)return [];
    try{
      const current=storage.getItem(key(o));
      if(current)return valid(JSON.parse(current),o);
      return valid(JSON.parse(storage.getItem(legacy)||'null'),o);
    }catch{return [];}
  }
  function write(o,items){
    if(!o)throw new Error('Ingresa nuevamente antes de guardar una marca.');
    try{
      // Guardar antes de retirar la cola anterior: si falta espacio, la original sobrevive.
      storage.setItem(key(o),JSON.stringify({...o,items}));
      let old;try{old=JSON.parse(storage.getItem(legacy)||'null');}catch{}
      if(same(old,o))storage.removeItem(legacy);
    }catch{throw new Error('No se pudo guardar la marca en este teléfono. Libera espacio e inténtalo de nuevo.');}
  }
  function enqueue(payload,capturado_en){
    const o=owner(),items=read(o);
    if(items.length>=10)throw new Error('Ya tienes 10 marcas guardadas sin enviar. Conéctate para enviarlas antes de marcar otra.');
    const marca_id=globalThis.crypto?.randomUUID?.()||'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
    items.push({marca_id,payload,capturado_en,guardada:Date.now()});write(o,items);
  }
  let syncing=false;
  async function sync(request){
    const result={sent:[],rejected:[],remaining:read().length},o=owner();
    if(syncing||!o)return result;
    syncing=true;
    try{
      for(const item of read(o)){
        if(!same(o,owner()))break;
        // Volver a leer evita sobrescribir marcas añadidas mientras había una solicitud en vuelo.
        const drop=()=>write(o,read(o).filter(i=>i.marca_id!==item.marca_id));
        if(Date.now()-item.guardada>maxAge){drop();result.rejected.push({capturado_en:item.capturado_en,message:'Pasaron más de 48 horas desde que la guardaste.'});continue;}
        try{
          const response=await request('marcar_asistencia',{...item.payload,marca_id:item.marca_id,capturado_en:item.capturado_en});
          drop();result.sent.push({...response,capturado_en:item.capturado_en});
        }catch(error){
          if(![400,409,422].includes(error?.status)||error?.offline)break;
          drop();result.rejected.push({capturado_en:item.capturado_en,message:error.message||'El servidor no aceptó la marca.'});
        }
      }
    }finally{syncing=false;result.remaining=read().length;}
    return result;
  }
  return {read,enqueue,sync};
}
