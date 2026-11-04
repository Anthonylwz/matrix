// Al pasar de Wi-Fi a datos móviles (o al revés), o tras un rato sin uso con datos móviles, la primera
// consulta puede salir por una conexión que ya no existe y fallar sin llegar al servidor. El APK no la
// repite por su cuenta, porque todas las consultas de la app son POST.
// Aquí se repite una sola vez, y solo si es de lectura: nunca una marcación, un ingreso ni un cambio.
// La repetición usa el mismo tiempo máximo de la consulta original, así que no alarga la espera.
export const netStats = { retried: 0, recovered: 0 };

function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function fetchRetry(url, init = {}, readOnly = false) {
  try {
    return await fetch(url, init);
  } catch (error) {
    // TypeError = no hubo respuesta (sin red, conexión cortada). Una cancelación o un tiempo agotado no se repiten.
    if (!readOnly || init.signal?.aborted || !(error instanceof TypeError) || navigator.onLine === false) throw error;
    netStats.retried++;
    await pause(400, init.signal);
    if (init.signal?.aborted) throw error;
    const response = await fetch(url, init);
    netStats.recovered++;
    return response;
  }
}

// Las capas de red (api.js, staff-api.js, student-api.js) la usan si está cargada; si no, usan fetch.
// Se registra en window para que esas capas no dependan de este módulo (y sus pruebas aisladas sigan igual).
window.ideasFetch = fetchRetry;
