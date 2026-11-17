// The web runtime: one device-independent interface for a page. Given a virtual device package and a viewer, it loads the
// firmware, wires the screen, inputs, servos, speaker, microphone, camera and computer connection, and reports status.
// The page knows nothing about any particular device: everything comes from the package's device description.
//
//   import { loadPackage, startVirtualDevice } from 'esp32-virtual-hardware/runtime';
//   const pkg = await loadPackage({ archiveUrl: '/media/x.vdpkg.tgz' }, { onProgress });       // one archive, or
//   const pkg = await loadPackage({ description, fileUrls: { 'firmware/x.mjs': url, … } });     // files stored one by one
//   const session = await startVirtualDevice({ pkg, viewer, onStatus });
//   session.repower(); session.setMic(true); session.setCamera(true); session.on('traffic', …); await session.dispose();
//   session.takeOverLink();  // status.link 'elsewhere': another tab of this browser has the computer connection; connect here instead
//
// The page must be cross-origin isolated (COOP same-origin + COEP require-corp): the firmware runs on threads.
//
// Viewer interface (the page's 3D viewer implements it; every method is optional, a missing one switches that part off).
// "Kit model coordinates" are those of the GLB scene as loaded (the manifest's units, mm), before the viewer centres or scales
// it. Nodes are named as in the GLB (a name = the first node of that name in the default scene, depth first). A node may sit
// under unnamed, rotated or scaled groups: every turn and offset below is in Kit model coordinates and the viewer converts it
// into the node's own parent space (three.js: new local matrix = parentInModel⁻¹ × motion × restInModel).
//   setScreenImage({ node, face }, { width, height, data })
//       Show data (RGBA bytes, rows from the top) on the screen face, mapped by its glTF texture coordinates (with three.js a
//       DataTexture with flipY = false, sRGB colour space, unlit). The face: start at the node named node, follow face.path
//       (indexes into glTF `children`, one per level; none = the node itself), take that node's mesh and its primitive
//       face.primitive (default 0); replace that primitive's material. three.js GLTFLoader: parser.associations maps objects to
//       glTF node indexes ({ nodes }) and mesh primitives ({ primitives }); a mesh with several primitives is a Group of Meshes.
//       Called again with the same buffer for every new frame: mark the texture as changed.
//   onPick(nodes, handler) → unsubscribe
//       Report pointer presses on these nodes (or anything under them) as handler({ node, phase, uv, point, nodeCenter }):
//       phase 'down' on press, 'move' while held over the node, 'up' on release (wherever the pointer is then; to the node
//       that got the 'down'); node = which of the given nodes; uv = [u, v] glTF texture coordinates of the hit (three.js
//       intersection.uv); point and nodeCenter = the hit and the node's bounding-box centre in Kit model coordinates (mm).
//       While a pick is held the viewer should not rotate the camera.
//   setRotation(nodes, turns)
//       nodes: names, or { node, path } = the unnamed node reached from the named one by glTF `children` indexes (as for the
//       screen face). Move these nodes from their place in the Kit model by a list of turns [{ pivot, axis, angleDeg }, …], applied in order:
//       each turns the result of the one before by angleDeg about the axis through pivot (right-hand rule). The first is the
//       servo's own joint, the next the joint it is mounted on, and so on; every pivot and axis is where it is in the Kit model
//       as loaded (rest pose), so the composition is exact (motion = turns[n-1] ∘ … ∘ turns[0]). pivot is [x, y, z] (mm) or
//       { node } = that node's bounding-box centre in the Kit model as loaded (not where it has moved to).
//   setOffset(nodes, offset)
//       Move these nodes from their place by offset [x, y, z] (mm, Kit model coordinates); null = back in place.
//   setHidden(patterns, hidden)
//       Hide (true) or show again (false) every node whose name matches one of the patterns (`*` = any run of characters;
//       nodeNameMatches in esp32-virtual-hardware/device-description), with everything under it. Called with true at start and
//       false at dispose.
import { DESCRIPTION_FILE, checkPackageFiles, validateDeviceDescription } from '../../device-description/validate.mjs';
import { readPackage } from '../package/index.mjs';
import { createVirtualDevice } from '../interface/virtual-device.mjs';
import { connectHostLink, hostLinkUrl } from './host-link.mjs';
import { createScreenImage, joystickFromPoint, servoJointAngle, uvToPanel } from './geometry.mjs';
import { createAudioIo } from './audio-io.mjs';
import { createCameraIo } from './camera-io.mjs';
import { downloadFile } from './download.mjs';

export { connectHostLink, hostLinkUrl, hostLinkLockName } from './host-link.mjs';
export { createScreenImage, uvToPanel, servoJointAngle, joystickFromPoint } from './geometry.mjs';
export { downloadFile } from './download.mjs';

/** A quick click still holds a button this long in device time, so firmware debouncing sees it. */
export const MIN_PRESS_MS = 100;
const LOG_LIMIT = 200_000;

/**
 * Load a package and check it (description format, every file present with its size and sha256).
 * source: { archiveUrl } — one package archive; or { description, fileUrls } — the description object and a URL per file path
 * (for packages stored file by file under server-made keys); or { description, baseUrl } — files at baseUrl + their path.
 * onProgress({ loaded, total }) in bytes. Each file is downloaded with downloadFile (download.mjs): a stalled or broken download is
 * resumed where it stopped; stallMs, retries, retryDelayMs and onRetry({ url, attempt, loaded, reason }) are passed to it, and when
 * it gives up the error has code 'download_failed'. Resolves to { description, files: Map<path, Uint8Array> }; rejects with every
 * problem.
 */
export async function loadPackage(source, { onProgress = () => {}, fetchImpl = globalThis.fetch, stallMs, retries, retryDelayMs, onRetry } = {}) {
  const net = { fetchImpl, stallMs, retries, retryDelayMs, onRetry };
  let description;
  let files;
  if (source.archiveUrl) {
    const bytes = await downloadFile(source.archiveUrl, { ...net, onProgress: (loaded, total) => onProgress({ loaded, total }) });
    ({ description, files } = await readPackage(bytes));
  } else {
    description = source.description;
    assertValid(description);
    const urlOf = (p) => source.fileUrls?.[p] ?? (source.baseUrl ? new URL(p, source.baseUrl).href : null);
    const total = description.files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    files = new Map();
    for (const f of description.files) {
      const url = urlOf(f.path);
      if (!url) throw new Error(`no URL for ${f.path}`);
      const before = done;
      files.set(f.path, await downloadFile(url, { ...net, size: f.size, onProgress: (loaded) => onProgress({ loaded: before + Math.min(loaded, f.size), total }) }));
      done += f.size;
    }
  }
  assertValid(description);
  const issues = await checkPackageFiles(description, files);
  if (issues.length) throw new Error(`virtual device package does not match its description:\n${issues.map((i) => `  ${i.message}`).join('\n')}`);
  return { description, files };
}

function assertValid(description) {
  const { issues } = validateDeviceDescription(description);
  if (issues.length) throw new Error(`${DESCRIPTION_FILE} is not valid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
}

/**
 * Start a virtual device. Options:
 *   pkg            from loadPackage(); or source (as for loadPackage) to load it here, reporting phase 'loading' with progress
 *   viewer         the page's viewer (see the interface above)
 *   onStatus(s)    every status change (also session.on('status'))
 *   hostLink       true (default): connect to ws://127.0.0.1:<port><path> from the description; false: no computer connection;
 *                  { url }: another address (development)
 *   audio, camera  true (default): wire the speaker / microphone / camera channels the description declares (browser only)
 *   firmwareFactory  the firmware module's factory, already loaded (Node, tests); by default it is imported from the package
 * Status: { phase: 'loading' | 'starting' | 'running' | 'off' | 'error', progress: { loaded, total } | null, bootCount,
 *           power: 'on' | 'off' | 'restart-requested' | 'halted', link: 'none' | 'waiting' | 'connected' | 'elsewhere' | 'closed',
 *           linkAttempts, speaker, mic, camera: 'none' | state, error: { code, message } | null }
 * Session: status, log (device log text), description, device (the virtual device interface), on(event, fn) for 'status', 'log' (text),
 *   'traffic' ({ direction: 'rx' | 'tx', bytes }), 'power'; repower(), setMic(on), setCamera(on), takeOverLink(), audio, camera, dispose().
 * The computer connection is one tab at a time (host-link.mjs): link 'elsewhere' = another tab of this browser holds it (this one opens no
 * socket and connects by itself when that tab lets go); takeOverLink() connects here at once and leaves the other tab 'elsewhere'.
 */
export async function startVirtualDevice(options) {
  const { viewer = {}, onStatus = () => {}, hostLink = true, audio: wantAudio = true, camera: wantCamera = true, WebSocketImpl } = options;
  const listeners = new Map();
  const emit = (ev, x) => { for (const fn of listeners.get(ev) ?? []) fn(x); };
  const status = { phase: 'loading', progress: null, bootCount: 0, power: 'off', link: 'none', linkAttempts: 0, speaker: 'none', mic: 'none', camera: 'none', error: null };
  const update = (patch) => { Object.assign(status, patch); onStatus(status); emit('status', status); };
  const fail = (code, err) => { update({ phase: 'error', error: { code, message: err?.message ?? String(err) } }); return err instanceof Error ? err : new Error(String(err)); };

  if (typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated) {
    throw fail('not_cross_origin_isolated', 'the page is not cross-origin isolated (COOP same-origin and COEP require-corp are needed for firmware threads)');
  }

  let pkg = options.pkg;
  if (!pkg) {
    update({ phase: 'loading', progress: { loaded: 0, total: 0 } });
    try { pkg = await loadPackage(options.source, { onProgress: (progress) => update({ progress }) }); } catch (err) { throw fail('load_failed', err); }
  }
  const d = pkg.description;
  assertValid(d);
  update({ phase: 'starting' });

  let factory = options.firmwareFactory;
  const blobUrls = [];
  if (!factory) {
    try { factory = await importFirmware(pkg, blobUrls); } catch (err) { throw fail('firmware_failed', err); }
  }

  const dev = createVirtualDevice(d, factory);
  const cleanups = [];
  let log = '';
  cleanups.push(dev.on('log', (t) => {
    log += t;
    if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT / 2);
    emit('log', t);
  }));
  cleanups.push(dev.on('power', (e) => {
    update({ power: e.state, bootCount: e.state === 'on' ? e.bootCount : status.bootCount });
    emit('power', e);
  }));

  // ---------- screen ----------
  if (d.screen && viewer.setScreenImage) {
    const image = createScreenImage(d.screen);
    const target = { node: d.screen.node, face: d.screen.face };
    const draw = () => viewer.setScreenImage(target, image);
    draw();
    let latest = null;
    let scheduled = false;
    const raf = globalThis.requestAnimationFrame;
    const flush = () => { scheduled = false; if (latest) { image.update(latest); latest = null; draw(); } };
    cleanups.push(dev.on('screen', (f) => {
      latest = f;
      if (!raf) { flush(); return; }
      if (!scheduled) { scheduled = true; raf(flush); }
    }));
  }

  // ---------- inputs ----------
  if (viewer.onPick) {
    for (const input of d.inputs ?? []) {
      const offsets = (down) => { if (input.press && viewer.setOffset) viewer.setOffset([input.node], down ? input.press.offsetMm : null); };
      if (input.kind === 'button') {
        const button = holdableButton(dev, input.button);
        cleanups.push(viewer.onPick([input.node], ({ phase }) => {
          if (phase === 'down') { offsets(true); button.press(); }
          else if (phase === 'up') button.release().then(() => offsets(false));
        }));
      } else if (input.kind === 'joystick') {
        const button = input.button !== undefined ? holdableButton(dev, input.button) : null;
        let pressed = false;
        cleanups.push(viewer.onPick([input.node], ({ phase, point, nodeCenter }) => {
          if (phase === 'up') {
            dev.setJoystick(0, 0);
            if (pressed) { pressed = false; button.release().then(() => offsets(false)); }
            return;
          }
          if (!point || !nodeCenter) return;
          const { x, y } = joystickFromPoint(input, point, nodeCenter);
          if (phase === 'down' && button && Math.hypot(x, y) < 0.3) { pressed = true; offsets(true); button.press(); return; }
          if (!pressed) dev.setJoystick(x, y);
        }));
      } else if (input.kind === 'touch') {
        let last = null;
        cleanups.push(viewer.onPick([input.node], ({ phase, uv }) => {
          if (phase === 'up') { if (last) dev.touch('up', last.x, last.y); last = null; return; }
          const p = uv ? uvToPanel(d.screen, uv) : null;
          if (!p) return;
          if (phase === 'down' || !last) dev.touch('down', p.x, p.y);
          else dev.touch('move', p.x, p.y);
          last = p;
        }));
      }
    }
  }

  // ---------- servos ----------
  if (d.servos?.length && viewer.setRotation) {
    const byId = new Map(d.servos.map((s) => [s.id, s]));
    const joint = new Map(); // id → joint angle; a servo not heard from yet is at its rest angle (0)
    const turnOf = (s) => ({ pivot: s.pivot, axis: s.axis, angleDeg: joint.get(s.id) ?? 0 });
    const turns = (s) => { const out = []; for (let at = s; at; at = byId.get(at.parent)) out.push(turnOf(at)); return out; };
    const childrenOf = (id) => d.servos.filter((c) => c.parent === id);
    const pose = (s) => { viewer.setRotation(s.nodes, turns(s)); for (const c of childrenOf(s.id)) pose(c); };
    cleanups.push(dev.on('servo', ({ id, angle, pulseUs }) => {
      const s = byId.get(id);
      if (!s || pulseUs === 0) return; // pulse 0 = released: the servo keeps its angle
      joint.set(id, servoJointAngle(s, angle));
      pose(s);
    }));
  }

  // ---------- nodes hidden while the device runs ----------
  if (d.hide?.length && viewer.setHidden) {
    viewer.setHidden(d.hide, true);
    cleanups.push(() => viewer.setHidden(d.hide, false));
  }

  // ---------- sound, camera ----------
  const browser = typeof globalThis.document !== 'undefined';
  let audio = null;
  let camera = null;
  const avState = (kind, s) => update({ [kind]: s });
  if (wantAudio && browser && (d.channels.out.includes('speaker') || d.channels.in.includes('mic')) && globalThis.AudioContext) {
    audio = createAudioIo(dev, { micRate: d.mic?.sampleRate ?? 16000, onState: avState });
    if (d.channels.in.includes('mic')) update({ mic: 'off' });
  }
  if (wantCamera && browser && d.channels.in.includes('camera')) {
    camera = createCameraIo(dev, { onState: avState });
    update({ camera: 'off' });
  }

  try {
    await dev.powerOn();
  } catch (err) {
    throw fail('power_on_failed', err);
  }
  update({ phase: 'running' });

  // ---------- computer connection ----------
  // Plugged in after power on and opened just before returning: the first bytes from the program arrive in a later task,
  // after the caller has had the chance to subscribe to 'traffic'.
  let link = null;
  if (d.hostLink && hostLink !== false) {
    const url = typeof hostLink === 'object' && hostLink.url ? hostLink.url : hostLinkUrl(d.hostLink);
    link = connectHostLink(dev, {
      url,
      WebSocketImpl,
      onState: (s, info) => update({ link: s, linkAttempts: info.attempts }),
      onTraffic: (direction, bytes) => emit('traffic', { direction, bytes }),
    });
  }


  let disposed = false;
  return {
    get status() { return status; },
    get log() { return log; },
    device: dev,
    description: d,
    audio,
    camera,
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    async repower() {
      log = '';
      await dev.restart();
      update({ phase: 'running' });
    },
    setMic(on) { return audio && d.channels.in.includes('mic') ? (on ? audio.micOn() : audio.micOff()) : null; },
    setCamera(on) { return camera ? (on ? camera.cameraOn() : camera.cameraOff()) : null; },
    takeOverLink() { link?.takeOver(); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      link?.close();
      audio?.dispose();
      camera?.dispose();
      for (const off of cleanups) off();
      await dev.powerOff();
      for (const u of blobUrls) URL.revokeObjectURL(u);
      update({ phase: 'off', power: 'off' });
    },
  };
}

/** A button that, pressed briefly, still stays down MIN_PRESS_MS of device time. */
function holdableButton(dev, id) {
  let downAt = 0;
  let releasing = Promise.resolve();
  return {
    press() { downAt = dev.clockMs; dev.pressButton(id, true); },
    release() {
      const until = downAt + MIN_PRESS_MS;
      releasing = releasing.then(async () => {
        if (dev.clockMs < until) await dev.waitForClock(until, 5000).catch(() => {});
        dev.pressButton(id, false);
      });
      return releasing;
    },
  };
}

/** Browser: the package's files as blob URLs; the firmware module imported from its blob URL and told where everything is. */
async function importFirmware(pkg, blobUrls) {
  const type = (p) => (p.endsWith('.wasm') ? 'application/wasm' : p.endsWith('.mjs') || p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
  const byName = new Map();
  let moduleUrl = null;
  for (const [p, bytes] of pkg.files) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type(p) }));
    blobUrls.push(url);
    byName.set(p.split('/').pop(), url);
    if (p === pkg.description.runtime.module) moduleUrl = url;
  }
  const { default: factory } = await import(/* @vite-ignore */ moduleUrl);
  // locateFile: the module asks for its side files (.wasm, .data) by name; mainScriptUrlOrBlob: firmware threads start from
  // the module itself (the build allows this option, tools/firmware.mjs).
  return (opts = {}) => factory({ locateFile: (name) => byName.get(name) ?? name, mainScriptUrlOrBlob: moduleUrl, ...opts });
}
