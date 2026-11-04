// Utilidades de foto de perfil: recorte cuadrado, compresión y selfie con la cámara de la app

const OUTPUT_SIZE = 640;
const OUTPUT_QUALITY = 0.85;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

// Decodifica respetando la orientación EXIF (fotos de celular giradas)
async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceSize(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width,
    h: src.videoHeight || src.naturalHeight || src.height
  };
}

// Recorte cuadrado centrado → JPEG liviano (≈60–120 KB)
export function squareJpeg(source, { mirror = false, size = OUTPUT_SIZE, quality = OUTPUT_QUALITY } = {}) {
  const { w, h } = sourceSize(source);
  if (!w || !h) throw new Error('Imagen vacía');
  const side = Math.min(w, h);
  const out = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fondo blanco: las PNG con transparencia no quedan negras al pasar a JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out, out);
  if (mirror) {
    ctx.translate(out, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function fileToSquareJpeg(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('El archivo no es una imagen');
  if (file.size > MAX_INPUT_BYTES) throw new Error('La imagen es demasiado grande');
  const img = await decodeImage(file);
  try {
    return squareJpeg(img);
  } finally {
    if (typeof img.close === 'function') img.close();
  }
}

// Data URL (por ejemplo, la que entrega la app Android) → File
export async function dataUrlToFile(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], 'foto', { type: blob.type || 'image/jpeg' });
}

// Cámara de la app para la foto de perfil: 'user' (frontal) o 'environment' (trasera)
export async function startSelfieCamera(video, facing = 'user') {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw Object.assign(new Error('Cámara no disponible'), { name: 'InsecureContextError' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false
  });
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', 'true');
  try { await video.play(); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); throw e; }
  return stream;
}

export function stopSelfieCamera(video, stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}
