// Reconocimiento del QR de asistencia antes de enviarlo.
// La validez real (firma, vigencia, pantalla autorizada) la decide siempre el servidor; aquí solo
// se descartan los QR que no son de asistencia (Wi-Fi, enlaces, productos…) para no enviarlos:
// en línea sumarían intentos fallidos y bloquearían el celular, y sin conexión se guardarían
// como pendientes para ser rechazados horas después.
//
// Formatos válidos:
//   t1.<pantalla>.<ventana>.<hmac32>   QR de pantalla vinculada (funciona sin Internet)
//   q1.<hex>.<hmac>                    QR rotativo del servidor
//   p1.<base64>.<hmac>                 QR permanente impreso
//   {"token": "..."} o un enlace con ?token= / ?token_qr= que contenga uno de los anteriores

const FORMATO_PANTALLA = /^t1\.\d{1,9}\.\d{1,12}\.[a-f0-9]{32}$/;
const FORMATO_SERVIDOR = /^(q1|p1)\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/;

const NO_ES_ASISTENCIA = {
  valid: false,
  code: 'UNRECOGNIZED_FORMAT',
  message: 'Este no es el QR de asistencia. Escanea el código de la pantalla de asistencia o el QR de la sede.'
};

// Extrae el token de un QR envuelto en JSON o en un enlace
function unwrapToken(text) {
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj.token === 'string') return obj.token.trim();
    } catch (_) {}
    return text;
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const token = url.searchParams.get('token') || url.searchParams.get('token_qr');
      if (token) return token.trim();
    } catch (_) {}
  }
  return text;
}

export async function verifySignedQR(rawQR) {
  if (!rawQR || typeof rawQR !== 'string') return NO_ES_ASISTENCIA;
  const token = unwrapToken(rawQR.trim());
  if (FORMATO_PANTALLA.test(token) || FORMATO_SERVIDOR.test(token)) {
    return { valid: true, code: 'ATTENDANCE_QR', cleanToken: token, tipo: 'auto' };
  }
  return NO_ES_ASISTENCIA;
}

// Compatibilidad: el control anti-repetición lo hace el servidor (ventana de 30 s e idempotencia)
export async function markNonceConsumed() {}
