/* Transporte de la API: una petición conserva su identidad y su cancelación hasta Android. */
(() => {
  'use strict';
  if (!window.AndroidNet) return;
  const pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  const pageId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  let sequence = 0;
  const cancel = id => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    request.cleanup();
    try { window.AndroidNet.cancelRequest(id); } catch (_) { /* APK anterior sin cancelación. */ }
    request.reject(new DOMException('Cancelado', 'AbortError'));
  };
  window.__nativeFetchDone = (id, status, body, type) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    request.cleanup();
    if (!status) { request.reject(new TypeError('Sin conexión con el servidor')); return; }
    try {
      const empty = status === 204 || status === 205 || status === 304;
      request.resolve(new Response(empty ? null : body, {
        status, headers: { 'Content-Type': type || 'application/json' }
      }));
    } catch (error) { request.reject(error); }
  };
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/asistencia_ideas/api/'))
      return nativeFetch(input, init);
    const source = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const signal = init.signal || source?.signal;
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelado', 'AbortError'));
    const method = String(init.method || source?.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers || source?.headers || {}));
    return Promise.resolve(init.body !== undefined ? init.body : source && !['GET', 'HEAD'].includes(method)
      ? source.clone().text() : null).then(body => {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (body != null && typeof body !== 'string') throw new TypeError('Tipo de cuerpo no soportado');
      return new Promise((resolve, reject) => {
        const id = pageId + '_' + (++sequence);
        const onAbort = () => cancel(id);
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        pending.set(id, { resolve, reject, cleanup });
        signal?.addEventListener('abort', onAbort, { once: true });
        try { window.AndroidNet.request(id, method, url.pathname + url.search, JSON.stringify(headers), body); }
        catch (error) { pending.delete(id); cleanup(); reject(error); }
      });
    });
  };
  window.addEventListener('pagehide', () => [...pending.keys()].forEach(cancel));
})();
