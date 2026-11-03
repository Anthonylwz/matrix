(() => {
 'use strict';
 const seasons=[{id:'october',month:10}];
 // En celulares, menos murciélagos: cada uno cuesta trabajo de dibujo en cada cuadro
 const batCount=()=>innerWidth<600?6:innerWidth<1100?9:10;
 // El vuelo se calcula a ~30 cuadros por segundo: vuelan despacio (20–40 px/s) y no se nota,
 // pero el celular hace la mitad de trabajo (a 60 cuadros la app iba a tirones)
 const FLIGHT_FRAME_MS=33;
 const reserveWidth=index=>(innerWidth<600?76:104)+index%4*4;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let layer,timer,layoutFrame,flightFrame,lastTime=0,elapsed=0,obstacles=[],bats=[];
 // Elementos que los murciélagos esquivan (panel y pantalla QR).
 // En la app del trabajador (pwa/) vuelan por detrás del contenido, así que no necesitan esquivar nada.
 const appTrabajador=!!document.getElementById('app-view');
 // En la app solo esquivan los textos sueltos sobre el fondo (detrás de las tarjetas pueden pasar)
 const selectors=appTrabajador?['.large-title','.nav-bar','.profile-head','.section-head','.list-header','.brand-lockup','.login__title','.login__subtitle','.server-status','.hero','.cta-secondary','.empty-state','.day-detail__status'].map(s=>'.view:not(.view--leaving) '+s).join(', '):'.qr-wrapper, #codigoNumerico, .welcome-greeting, .clock-time, .mark-toast, .screen-notice, .qr-locked, input, textarea, button, .ideas-official-logo, .ideas-season-label, h1, h2, .notification-panel:not([hidden]), dialog[open]';
 function blocked(x,y,w){return obstacles.some(r=>x+w>r.left&&x<r.right&&y+w/2>r.top&&y<r.bottom);}
 function safe(x,y,w){return x>=0&&y>=0&&x+w<=innerWidth&&y+w/2<=innerHeight&&!blocked(x,y,w);}
 function place(bat){
  if(safe(bat.x,bat.y,bat.width))return;
  for(let attempt=0;attempt<100;attempt++){
   const x=Math.random()*Math.max(0,innerWidth-bat.width),y=Math.random()*Math.max(0,innerHeight-bat.width/2);
   if(safe(x,y,bat.width)){bat.x=x;bat.y=y;return;}
  }
 }
 function paint(bat){
  const hidden=bat.index>=batCount()||!safe(bat.x,bat.y,bat.width);
  if(bat.el.hidden!==hidden)bat.el.hidden=hidden;
  const bank=Math.sin(bat.heading)*12;
  const depth=.28+.66*(.5+.5*Math.sin(elapsed*bat.depthSpeed+bat.depthPhase));
  // Posición, tamaño e inclinación en una sola transformación (un solo elemento por murciélago)
  bat.el.style.transform=`translate3d(${bat.x.toFixed(1)}px,${bat.y.toFixed(1)}px,0) scale(${depth.toFixed(3)}) rotate(${bank.toFixed(1)}deg)`;
  // La opacidad cambia muy despacio: se actualiza solo si varía de forma visible
  const op=(.62+.3*depth).toFixed(2);
  if(bat.op!==op){bat.op=op;bat.el.style.opacity=op;}
 }
 function layout(){
  if(!layer)return;
  obstacles=[...document.querySelectorAll(selectors)].map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>({left:r.left-14,right:r.right+14,top:r.top-14,bottom:r.bottom+14}));
  bats.forEach(bat=>{bat.width=reserveWidth(bat.index);bat.el.style.width=bat.width+'px';place(bat);paint(bat);});
 }
 function tick(now){
  flightFrame=null;
  if(!layer||document.hidden||reduced.matches)return;
  if(lastTime&&now-lastTime<FLIGHT_FRAME_MS-2){flightFrame=requestAnimationFrame(tick);return;}
  const dt=lastTime?Math.min((now-lastTime)/1000,.08):0;lastTime=now;elapsed+=dt;
  for(const bat of bats){
   if(bat.index>=batCount())continue;
   // Each bat cruises across the viewport; small steering changes never anchor it.
   const desired=bat.heading+Math.sin(elapsed*.4+bat.index*2.1)*dt*.3;
   const speed=bat.speed*(1+.12*Math.sin(elapsed*.65+bat.index));
   const lookAhead=Math.max(26,speed*.55);
   let heading=desired,found=false;
   const side=bat.index%2?1:-1;
   for(const turn of [0,.35,-.35,.7,-.7,1.2,-1.2,1.8,-1.8,Math.PI]){
    const candidate=desired+turn*side;
    if(safe(bat.x+Math.cos(candidate)*lookAhead,bat.y+Math.sin(candidate)*lookAhead,bat.width)){
     heading=candidate;found=true;break;
    }
   }
   if(found){
    const x=bat.x+Math.cos(heading)*speed*dt,y=bat.y+Math.sin(heading)*speed*dt;
    if(safe(x,y,bat.width)){bat.x=x;bat.y=y;bat.heading=heading;}
   }else bat.heading+=dt;
   paint(bat);
  }
  flightFrame=requestAnimationFrame(tick);
 }
 function stop(){if(flightFrame)cancelAnimationFrame(flightFrame);flightFrame=null;lastTime=0;}
 // En pantallas inmersivas de la app (escáner) los murciélagos descansan: no compiten con la cámara
 function immersive(){return document.body&&document.body.classList.contains('is-immersive');}
 function start(){stop();if(layer&&!document.hidden&&!reduced.matches&&!immersive())flightFrame=requestAnimationFrame(tick);}
 function update(){
  const month=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',month:'numeric'}).format(new Date()));
  // Se puede desactivar: data-temporada="off" en <html> (panel/perfil) o en el navegador (app del trabajador)
  // El panel trae su preferencia en <html data-temporada>; la app del trabajador la guarda en el navegador.
  // Si la página define la suya, manda esa (así una preferencia de la app no bloquea al panel en el mismo navegador).
  const pref=document.documentElement.dataset.temporada;
  const apagada=pref?pref==='off':(()=>{try{return localStorage.getItem('ideas-temporada')==='off'||localStorage.getItem('ideas-temporada-global')==='off';}catch(_){return false;}})();
  const season=apagada?null:seasons.find(item=>item.month===month);
  document.documentElement.classList.toggle('ideas-october',season?.id==='october');
  if(!season){stop();layer?.remove();layer=null;bats=[];document.querySelectorAll('.ideas-season-label').forEach(el=>el.remove());return;}
  document.querySelectorAll('.sidebar-brand, .login-header').forEach(host=>{
   if(host.querySelector('.ideas-season-label'))return;
   const label=document.createElement('span');label.className='ideas-season-label';label.textContent='Octubre · Halloween';host.append(label);
  });
  if(layer){layout();return;}
  layer=document.createElement('div');layer.className='ideas-bat-layer';layer.setAttribute('aria-hidden','true');
  // Generate once per page entry; refresh/scroll checks preserve the ongoing flight.
  bats=Array.from({length:10},(_,index)=>{
   // Reserve the near-camera size so scaling never grows into protected controls.
   const el=document.createElement('span'),width=reserveWidth(index);
   el.className='ideas-bat';el.style.width=width+'px';el.style.setProperty('--flap-duration',(.65+Math.random()*.32)+'s');el.style.setProperty('--flight-delay',(-Math.random())+'s');
   const wings=document.createElement('span');wings.className='ideas-bat-wings';
   for(const part of ['left','right','body']){const piece=document.createElement('span');piece.className='ideas-bat-part ideas-bat-'+part;wings.append(piece);}
   el.append(wings);layer.append(el);
   return {el,index,width,x:Math.random()*Math.max(0,innerWidth-width),y:Math.random()*Math.max(0,innerHeight-width/2),heading:Math.random()*Math.PI*2,speed:20+Math.random()*20,depthSpeed:.22+Math.random()*.12,depthPhase:Math.random()*Math.PI*2};
  });
  document.body.append(layer);layout();start();
 }
 function scheduleLayout(){if(layoutFrame||immersive())return;layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;layout();});}
 function resume(){clearInterval(timer);document.documentElement.classList.toggle('ideas-season-paused',document.hidden);if(document.hidden){stop();return;}update();start();timer=setInterval(update,60000);}
 resume();
 window.addEventListener('resize',scheduleLayout,{passive:true});
 window.addEventListener('scroll',scheduleLayout,{passive:true,capture:true});
 window.addEventListener('load',scheduleLayout);
 const observer=new ResizeObserver(scheduleLayout);
 [document.body,...document.querySelectorAll('.login-shell, .sidebar-brand, .qr-wrapper, #codigoNumerico, .notification-panel')].forEach(el=>observer.observe(el));
 // childList: al cambiar de pantalla (app del trabajador) se recalculan las zonas a esquivar
 new MutationObserver(records=>{if(records.some(r=>!layer||!layer.contains(r.target)))scheduleLayout();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open']});
 document.fonts?.ready.then(scheduleLayout);
 document.addEventListener('load',scheduleLayout,true);
 document.addEventListener('visibilitychange',resume);
 window.addEventListener('ideas:temporada',()=>{update();start();});
 // Pausa breve (p. ej. mientras la app cambia de tema): menos trabajo, transición más fluida
 window.addEventListener('ideas:pausa',()=>{stop();document.documentElement.classList.add('ideas-season-paused');});
 window.addEventListener('ideas:reanudar',()=>{document.documentElement.classList.remove('ideas-season-paused');start();});
 reduced.addEventListener('change',()=>{layout();start();});
 window.addEventListener('pagehide',()=>{clearInterval(timer);stop();});
 window.addEventListener('pageshow',resume);
})();
