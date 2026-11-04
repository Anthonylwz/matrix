import {escapeHtml} from '../js/utils.js';
import {apiRequest} from '../js/api.js';
import {getUser,getToken} from '../js/auth.js';
import {rowIcon} from '../js/icons.js';
import {phoneChatMarkup} from '../js/contact-links.js';
export function render(container){container.innerHTML=`<div class="page"><p class="sheet-hint">Toca un número para abrir WhatsApp. El chat se abre sin mensaje escrito.</p><form id="contacts-search"><label for="contacts-query">Nombre del compañero</label><div class="contacts-search"><input class="ios-input" id="contacts-query" name="q" maxlength="100" placeholder="Buscar por nombre"><button class="ios-btn ios-btn-primary" type="submit">Buscar</button></div></form><div id="contacts-results" aria-live="polite"></div></div>`;}
export async function init(){
 const form=document.getElementById('contacts-search'),results=document.getElementById('contacts-results');if(!form||!results)return;
 let controller=null,sequence=0,query='';
 const skeleton=()=>'<div class="ios-card ios-card--flush" role="status" aria-label="Actualizando compañeros">'+Array.from({length:4},()=>'<div class="skeleton-row"><span class="skeleton skeleton--block"></span><span class="skeleton skeleton--line skeleton--w60"></span></div>').join('')+'</div>';
 async function load(page=1){
  controller?.abort();controller=new AbortController();const revision=++sequence;results.innerHTML=skeleton();
  const result=await apiRequest('companeros.php',{signal:controller.signal,body:{trabajador_id:getUser()?.id,token_sesion:getToken(),q:query,page}});
  if(!results.isConnected||revision!==sequence||result.cancelled)return;
  if(!result.success){results.innerHTML=`<div class="ios-card"><p>${escapeHtml(result.message||'No se pudo consultar el directorio.')}</p><button class="ios-btn ios-btn-secondary" id="contacts-retry">Reintentar</button></div>`;results.querySelector('#contacts-retry').onclick=()=>load(page);return;}
  const data=result.data;results.innerHTML=`<div class="list-header">${Number(data.total)} compañeros</div><div class="ios-card ios-card--flush list-group--icons">${data.items.map(w=>`<div class="list-row">${rowIcon('user','orange')}<span class="list-row__main"><span>${escapeHtml(w.nombres+' '+w.apellidos)}</span><span class="list-row__sub">${escapeHtml([w.cargo,w.area].filter(Boolean).join(' · ')||'Instituto IDEAS')}</span><span class="contacts-phone">${phoneChatMarkup(w.telefono,w.nombres+' '+w.apellidos)}</span></span></div>`).join('')||'<div class="empty-note">No se encontraron compañeros.</div>'}</div><div class="contacts-pages"><button class="ios-btn ios-btn-secondary" id="contacts-prev" ${data.page<=1?'disabled':''}>Anterior</button><span>${data.page} / ${data.pages}</span><button class="ios-btn ios-btn-secondary" id="contacts-next" ${data.page>=data.pages?'disabled':''}>Siguiente</button></div>`;
  results.querySelector('#contacts-prev').onclick=()=>load(data.page-1);results.querySelector('#contacts-next').onclick=()=>load(data.page+1);
 }
 form.onsubmit=e=>{e.preventDefault();query=form.querySelector('input').value.trim();load(1);};
 window.addEventListener('hashchange',()=>controller?.abort(),{once:true});await load();
}
