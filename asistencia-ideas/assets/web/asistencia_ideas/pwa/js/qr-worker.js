// Lector QR en segundo plano: jsQR analiza los cuadros fuera del hilo principal,
// así la cámara y las animaciones no se traban mientras se busca el código.
self.importScripts('jsQR.min.js');

self.onmessage = (e) => {
  const { id, data, width, height, invert } = e.data;
  let result = null;
  try {
    const code = self.jsQR(new Uint8ClampedArray(data), width, height, {
      inversionAttempts: invert ? 'attemptBoth' : 'dontInvert'
    });
    if (code && code.data) {
      const l = code.location;
      result = {
        text: code.data,
        points: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner]
      };
    }
  } catch (_) {}
  self.postMessage({ id, result });
};
