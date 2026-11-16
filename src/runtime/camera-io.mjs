// Camera of a virtual device page: the computer's camera (getUserMedia) → the interface's camera channel. Device independent;
// browser only. Reports states, never words.
//
// When the firmware asks for a frame (setCameraSource, with its width, height and format), the current picture is cropped to
// that size from the centre (not mirrored: what the camera sees) and encoded as JPEG. While the camera is off, refused or taken
// away, a dark placeholder frame is given instead: the real camera is always there and firmwares check it at boot, backing off
// for minutes when no frame comes (the placeholder is like a lens cap).
//
//   const camera = createCameraIo(dev, { onState });  await camera.cameraOn();  camera.cameraOff();
//   camera.feedUrl(url) (test hook: a picture as the camera; feedUrl(null) stops)
//   onState('camera', 'off' | 'starting' | 'on' | 'feeding' | 'denied' | 'error', detail)

const JPEG_QUALITY = 0.8;

export function createCameraIo(dev, { onState = () => {} } = {}) {
  let state = 'off';
  let stream = null;
  let video = null;
  let image = null;
  let requests = 0;
  let frames = 0;
  let lastRequest = null;
  let lastJpeg = null;
  const setState = (s, detail) => { state = s; onState('camera', s, detail); };

  dev.setCameraSource(async (req) => {
    requests++;
    lastRequest = req;
    if (req.format !== 'jpeg' || !req.width || !req.height) return null;
    const source = state === 'feeding' ? image : state === 'on' && video?.readyState >= 2 ? video : null;
    const bytes = await encodeFrame(source, req.width, req.height);
    frames++;
    lastJpeg = bytes;
    return bytes;
  });

  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) { video.srcObject = null; video = null; }
  }

  async function cameraOn() {
    if (state === 'on' || state === 'starting') return state;
    image = null;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) { setState('error', 'unsupported'); return state; }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) {
      if (state !== 'starting') return state;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setState(denied ? 'denied' : 'error', err?.name ?? String(err));
      return state;
    }
    if (state !== 'starting') { s.getTracks().forEach((t) => t.stop()); return state; }
    stream = s;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { stopStream(); setState('denied', 'ended'); });
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      stopStream();
      setState('error', err?.message ?? String(err));
      return state;
    }
    setState('on');
    return state;
  }

  function cameraOff() { stopStream(); image = null; setState('off'); }

  async function feedUrl(url) {
    if (!url) { cameraOff(); return; }
    stopStream();
    const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.blob(); });
    image = await createImageBitmap(blob);
    setState('feeding');
  }

  return {
    cameraOn, cameraOff, feedUrl,
    get state() { return state; },
    lastJpeg: () => lastJpeg,
    stats: () => ({ state, requests, frames, lastRequest, lastJpegBytes: lastJpeg?.length ?? 0 }),
    dispose() { stopStream(); dev.setCameraSource(null); },
  };
}

/** The picture (video, image or null for the placeholder), cropped from the centre to w×h, as JPEG bytes. */
async function encodeFrame(source, w, h) {
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d');
  if (source) {
    const sw = source.videoWidth ?? source.width;
    const sh = source.videoHeight ?? source.height;
    const scale = Math.max(w / sw, h / sh);
    const cw = w / scale;
    const ch = h / scale;
    g.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  } else {
    g.fillStyle = '#202020';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#5a5a5a';
    g.lineWidth = Math.max(2, Math.round(h / 40));
    const r = Math.round(h / 6);
    g.beginPath();
    g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    g.moveTo(w / 2 - r * 1.4, h / 2 + r * 1.4);
    g.lineTo(w / 2 + r * 1.4, h / 2 - r * 1.4);
    g.stroke();
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return new Uint8Array(await blob.arrayBuffer());
}
