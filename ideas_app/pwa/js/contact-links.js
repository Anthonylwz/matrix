// Solo abre un chat; nunca envía un mensaje ni añade texto al enlace.
export function whatsappChatUrl(phone){
 if(typeof phone!=='string'||phone.length>50||!/^\+?[0-9 ()-]+$/.test(phone.trim()))return null;
 const raw=phone.trim(),international=raw.startsWith('+')||raw.startsWith('00');let digits=raw.replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(!international&&/^9[0-9]{8}$/.test(digits))digits='51'+digits;
 else if(!international&&!/^519[0-9]{8}$/.test(digits))return null;
 return /^[1-9][0-9]{7,14}$/.test(digits)?'https://wa.me/'+digits:null;
}
export function phoneChatMarkup(phone,name=''){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const url=whatsappChatUrl(phone);
 return url?`<a class="phone-chat" href="${url}" target="${typeof window!=='undefined'&&window.AndroidNet?'_self':'_blank'}" rel="noopener noreferrer" aria-label="Abrir WhatsApp con ${esc(name||phone)}">${esc(phone)}</a>`:esc(phone||'Teléfono sin registrar');
}
