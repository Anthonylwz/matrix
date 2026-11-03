// Controlador de cámara y escaneo de códigos QR
import { hapticFeedback } from './utils.js';

// Intervalo entre lecturas: rápido para leer al instante sin calentar el teléfono
const SCAN_INTERVAL_MS = 90;
// Lado máximo de los recortes que analiza jsQR. El QR de la pantalla es denso (≈49×49
// módulos): reducirlo demasiado lo deja en 2–3 px por módulo y deja de leerse.
const CROP_NEAR_MAX = 760;   // zona del marco, casi sin reducir
const CROP_WIDE_MAX = 640;   // zona amplia (código fuera del marco o lejano)
// Con lector nativo, jsQR solo revisa uno de cada N cuadros (respaldo para pantallas con reflejo)
const JSQR_EVERY_WITH_NATIVE = 4;
// El mismo texto no se procesa otra vez antes de este tiempo (salvo al reintentar)
const SAME_CODE_MS = 6000;

// jsQR (≈130 KB) se descarga solo cuando hace falta, no al abrir la app
let jsQRLoading = null;
export function loadJsQR() {
  if (typeof window.jsQR === 'function') return Promise.resolve(true);
  if (!jsQRLoading) {
    jsQRLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/jsQR.min.js';
      s.async = true;
      s.onload = () => resolve(typeof window.jsQR === 'function');
      s.onerror = () => { jsQRLoading = null; resolve(false); };
      document.head.appendChild(s);
    });
  }
  return jsQRLoading;
}

// Hilo de lectura en segundo plano (uno para toda la app). Si el equipo no permite
// workers, se usa jsQR en el hilo principal.
let worker = null;
let workerBroken = false;
let workerSeq = 0;
const workerWaiting = new Map();
function getWorker() {
  if (worker || workerBroken || typeof Worker !== 'function') return worker;
  try {
    worker = new Worker('js/qr-worker.js');
    worker.onmessage = (e) => {
      const done = workerWaiting.get(e.data.id);
      if (done) { workerWaiting.delete(e.data.id); done(e.data.result); }
    };
    worker.onerror = disableWorker;
  } catch (_) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

// Un lector bloqueado se retira: evita acumular cuadros y permite el respaldo local.
function disableWorker() {
  workerBroken = true;
  try { worker?.terminate(); } catch (_) {}
  worker = null;
  const pending = [...workerWaiting.values()];
  workerWaiting.clear();
  pending.forEach(done => done(null));
}

// Decodifica un ImageData: en el worker si está disponible; si no, en este hilo
function decode(imageData, invert) {
  const w = getWorker();
  if (w) {
    return new Promise((resolve) => {
      const id = ++workerSeq;
      // Si el worker no responde a tiempo (equipo lento), se descarta este cuadro
      const timer = setTimeout(disableWorker, 1500);
      workerWaiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(r || null); // El siguiente cuadro usa jsQR local si el worker falló.
      });
      try {
        w.postMessage({ id, data: imageData.data.buffer, width: imageData.width, height: imageData.height, invert }, [imageData.data.buffer]);
      } catch (_) { disableWorker(); }
    });
  }
  return Promise.resolve(decodeHere(imageData, invert));
}

function decodeHere(imageData, invert) {
  if (typeof window.jsQR !== 'function') return null;
  const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: invert ? 'attemptBoth' : 'dontInvert'
  });
  if (!code || !code.data) return null;
  const l = code.location;
  return { text: code.data, points: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] };
}

export class QRScannerController {
  constructor(videoElement, onScanCallback, onErrorCallback) {
    this.video = videoElement;
    this.onScan = onScanCallback;
    this.onError = onErrorCallback;
    this.stream = null;
    this.active = false;
    this.paused = false;
    this.animationId = null;
    this.canvas = document.createElement('canvas');
    this.canvasCtx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.currentFacingMode = 'environment';
    this.lastScannedCode = null;
    this.lastScannedTimestamp = 0;
    this.barcodeDetector = null;
    this.torchOn = false;
    this.zoom = 1;
    this.startId = 0;
    // Devuelve la zona del marco en coordenadas normalizadas del video (0..1); la fija la pantalla
    this.regionProvider = null;

    // BarcodeDetector nativo si está soportado (Chrome en Android; no en iPhone ni en la app)
    if ('BarcodeDetector' in window) {
      try {
        this.barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (_) {
        this.barcodeDetector = null;
      }
    }
    // jsQR siempre listo: es el respaldo y, sin lector nativo, el único lector
    loadJsQR();
    getWorker();
    if (this.barcodeDetector && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      // Algunos Android sin servicios de Google exponen el lector pero sin soporte de QR
      window.BarcodeDetector.getSupportedFormats().then((formats) => {
        if (!formats || !formats.includes('qr_code')) this.barcodeDetector = null;
      }).catch(() => {});
    }
  }

  get facingMode() {
    return this.currentFacingMode;
  }

  setScanRegion(fn) {
    this.regionProvider = typeof fn === 'function' ? fn : null;
  }

  // Inicia la cámara (trasera por defecto)
  async start() {
    this.stop();
    const id = ++this.startId;
    this.paused = false;
    this.torchOn = false;
    this.zoom = 1;

    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const err = new Error('La cámara requiere una conexión segura');
        err.name = 'InsecureContextError';
        throw err;
      }

      // Resolución alta: el QR de la pantalla tiene muchos módulos y a baja resolución no se distinguen
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: this.currentFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
      } catch (err) {
        if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.currentFacingMode }, audio: false });
        } else {
          throw err;
        }
      }

      // Otro start() o stop() llegó mientras se pedía la cámara: se descarta este flujo
      if (id !== this.startId || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        return { success: false, cancelled: true };
      }

      this.stream = stream;
      this.applyFocus();
      if (this.video) {
        this.video.srcObject = stream;
        this.video.setAttribute('playsinline', 'true');
        this.video.muted = true;
        await this.video.play();
        if (id !== this.startId) return { success: false, cancelled: true };
        if (document.hidden) { this.stop(); return { success: false, cancelled: true }; }
        this.active = true;
        this.startScanningLoop();
      }
      return { success: true };
    } catch (error) {
      if (id !== this.startId) return { success: false, cancelled: true };
      // play() interrumpido por un stop() posterior no es un error real
      if (error && error.name === 'AbortError' && !this.stream) return { success: false, cancelled: true };
      console.warn('Error al iniciar cámara:', error);
      this.stop();
      if (this.onError) this.onError(error);
      return {
        success: false,
        error: error.name || 'CameraError',
        message: this.getFriendlyErrorMessage(error)
      };
    }
  }

  // Enfoque y exposición continuos si la cámara lo permite (de cerca, muchas cámaras desenfocan)
  applyFocus() {
    const track = this.track();
    if (!track || typeof track.applyConstraints !== 'function') return;
    const caps = this.capabilities();
    const advanced = {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
    if (Object.keys(advanced).length) track.applyConstraints({ advanced: [advanced] }).catch(() => {});
  }

  // Mensaje amigable según el tipo de error
  getFriendlyErrorMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'No hay permiso para usar la cámara. Actívalo en los ajustes del teléfono o usa el código manual.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return 'No se encontró una cámara disponible. Puedes usar el código manual.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.';
    }
    if (name === 'InsecureContextError') {
      return 'La cámara solo funciona con conexión segura (HTTPS). Usa el código manual.';
    }
    return 'No se pudo iniciar la cámara. Vuelve a intentarlo o usa el código manual.';
  }

  // Alterna entre cámara trasera y delantera
  async switchCamera() {
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    return await this.start();
  }

  track() {
    return this.stream ? this.stream.getVideoTracks()[0] || null : null;
  }

  capabilities() {
    const track = this.track();
    if (!track || typeof track.getCapabilities !== 'function') return {};
    try {
      return track.getCapabilities() || {};
    } catch (_) {
      return {};
    }
  }

  // Indica si la cámara actual tiene linterna
  hasTorch() {
    return Boolean(this.capabilities().torch);
  }

  // Alterna la linterna; devuelve el estado real
  async toggleTorch() {
    const track = this.track();
    if (!track || !this.hasTorch()) return false;
    const next = !this.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      this.torchOn = next;
    } catch (_) {}
    return this.torchOn;
  }

  // Rango de zoom óptico/digital que ofrece la cámara (null si no hay)
  zoomRange() {
    const z = this.capabilities().zoom;
    if (!z || typeof z.max !== 'number' || z.max <= (z.min || 1)) return null;
    return { min: z.min || 1, max: z.max };
  }

  async setZoom(value) {
    const track = this.track();
    const range = this.zoomRange();
    if (!track || !range) return this.zoom;
    const target = Math.min(range.max, Math.max(range.min, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      this.zoom = target;
    } catch (_) {}
    return this.zoom;
  }

  // Zona a analizar en píxeles del video. near = el marco (con margen); si no = zona amplia.
  scanRect(near) {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return null;
    if (near && this.regionProvider) {
      const r = this.regionProvider();
      if (r && r.w > 0 && r.h > 0) {
        // Margen del 18% alrededor del marco: el código no tiene que quedar perfectamente encuadrado
        const mx = r.w * 0.18, my = r.h * 0.18;
        let x = Math.max(0, (r.x - mx) * w), y = Math.max(0, (r.y - my) * h);
        let x2 = Math.min(w, (r.x + r.w + mx) * w), y2 = Math.min(h, (r.y + r.h + my) * h);
        if (x2 - x > 32 && y2 - y > 32) return { x, y, w: x2 - x, h: y2 - y, max: CROP_NEAR_MAX };
      }
    }
    const side = Math.min(w, h) * 0.92;
    return { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side, max: CROP_WIDE_MAX };
  }

  readCrop(rect) {
    const k = Math.max(rect.w, rect.h) / rect.max;
    const scale = k > 1 ? 1 / k : 1;
    const ow = Math.max(1, Math.round(rect.w * scale));
    const oh = Math.max(1, Math.round(rect.h * scale));
    if (this.canvas.width !== ow || this.canvas.height !== oh) {
      this.canvas.width = ow;
      this.canvas.height = oh;
    }
    this.canvasCtx.drawImage(this.video, rect.x, rect.y, rect.w, rect.h, 0, 0, ow, oh);
    return { image: this.canvasCtx.getImageData(0, 0, ow, oh), map: { sx: rect.x, sy: rect.y, k: 1 / scale } };
  }

  // Bucle de lectura de fotogramas del video
  startScanningLoop() {
    let lastRun = 0;
    let busy = false;
    let frame = 0;
    const loopId = this.startId;

    const scanFrame = async (now) => {
      if (!this.active || loopId !== this.startId) return;
      this.animationId = requestAnimationFrame(scanFrame);

      if (busy || this.paused || now - lastRun < SCAN_INTERVAL_MS) return;
      if (this.video.readyState < 2 || !this.video.videoWidth) return;
      lastRun = now;
      busy = true;
      frame++;

      try {
        let detectedText = null;
        let box = null;
        let nativeOk = false;

        if (this.barcodeDetector) {
          try {
            const barcodes = await this.barcodeDetector.detect(this.video);
            nativeOk = true;
            if (barcodes && barcodes.length > 0) {
              detectedText = barcodes[0].rawValue;
              const b = barcodes[0].boundingBox;
              if (b) box = { x: b.x, y: b.y, w: b.width, h: b.height };
            }
          } catch (_) {
            // El lector nativo falló en este equipo: queda solo jsQR
            this.barcodeDetector = null;
          }
        }

        const jsqrReady = !workerBroken || typeof window.jsQR === 'function';
        const runJsQR = !detectedText && jsqrReady && (!nativeOk || frame % JSQR_EVERY_WITH_NATIVE === 0);
        if (runJsQR) {
          // Tres de cada cuatro cuadros miran el marco (casi sin reducir); uno, la zona amplia.
          // Cada tercer intento prueba también colores invertidos (pantallas en modo oscuro).
          const near = frame % 4 !== 0;
          const rect = this.scanRect(near);
          if (rect) {
            const { image, map } = this.readCrop(rect);
            const found = await decode(image, frame % 3 === 0);
            if (found && found.text && this.active && loopId === this.startId) {
              detectedText = found.text;
              const pts = found.points.map((p) => ({ x: map.sx + p.x * map.k, y: map.sy + p.y * map.k }));
              const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
              box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
            }
          }
        }
        if (box) {
          box.vw = this.video.videoWidth;
          box.vh = this.video.videoHeight;
        }

        if (detectedText && this.active && !this.paused && loopId === this.startId) {
          const t = Date.now();
          if (detectedText !== this.lastScannedCode || t - this.lastScannedTimestamp > SAME_CODE_MS) {
            this.lastScannedCode = detectedText;
            this.lastScannedTimestamp = t;
            this.paused = true;
            hapticFeedback([12]);
            if (this.onScan) this.onScan(detectedText, box);
          }
        }
      } catch (err) {
        console.warn('Error al leer el cuadro:', err);
      } finally {
        busy = false;
      }
    };

    this.animationId = requestAnimationFrame(scanFrame);
  }

  // Pausa temporal del escaneo (mantiene la cámara encendida)
  pause() {
    this.paused = true;
  }

  // Reanuda el escaneo; permite volver a leer el mismo código (reintento)
  resume() {
    this.lastScannedCode = null;
    this.paused = false;
  }

  // Detiene completamente la cámara (y la linterna)
  stop() {
    this.startId++;
    this.active = false;
    this.paused = false;
    this.torchOn = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}
