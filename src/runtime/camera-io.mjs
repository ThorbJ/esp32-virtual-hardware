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
  // Every switch (on, off, feed, dispose) starts a new generation. A start begun under an older one (a permission prompt
  // answered late, a video still starting) is stale: it stops its own stream and never touches the current one.
  let generation = 0;
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

  const release = (s, v) => {
    s.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  };

  function stopStream() {
    if (stream) release(stream, video);
    stream = null;
    video = null;
  }

  async function cameraOn() {
    if (state === 'on' || state === 'starting') return state;
    const gen = ++generation;
    image = null;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) { setState('error', 'unsupported'); return state; }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) {
      if (gen !== generation) return state;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setState(denied ? 'denied' : 'error', err?.name ?? String(err));
      return state;
    }
    if (gen !== generation) { release(s); return state; } // switched off (or on again) meanwhile
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = s;
    stream = s;
    video = v;
    s.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream !== s) return;
      generation++;
      stopStream();
      setState('denied', 'ended');
    });
    try {
      await v.play();
    } catch (err) {
      if (gen !== generation) { release(s, v); return state; }
      stopStream();
      setState('error', err?.message ?? String(err));
      return state;
    }
    if (gen !== generation) { release(s, v); return state; }
    setState('on');
    return state;
  }

  function cameraOff() { generation++; stopStream(); image = null; setState('off'); }

  async function feedUrl(url) {
    if (!url) { cameraOff(); return; }
    const gen = ++generation;
    stopStream();
    const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.blob(); });
    const bitmap = await createImageBitmap(blob);
    if (gen !== generation) return;
    image = bitmap;
    setState('feeding');
  }

  return {
    cameraOn, cameraOff, feedUrl,
    get state() { return state; },
    lastJpeg: () => lastJpeg,
    stats: () => ({ state, requests, frames, lastRequest, lastJpegBytes: lastJpeg?.length ?? 0 }),
    dispose() { generation++; stopStream(); dev.setCameraSource(null); },
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
