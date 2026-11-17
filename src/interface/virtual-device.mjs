// The virtual device interface: the one boundary between a firmware (WebAssembly) and the outside world.
//
// Everything that goes in or out of the firmware passes here; the web runtime and the Node tests use only this.
// Runs in the browser and in Node; the caller loads the firmware module (an emscripten factory) and passes it in.
//
//   const dev = createVirtualDevice(description, firmwareFactory);
//   dev.on('screen', (frame) => …);  dev.on('log', (text) => …);
//   await dev.powerOn();  …  await dev.powerOff();
//
// In:  pressButton / setJoystick / touch / pushMic / setMicLive / setCameraSource / hostWrite / setHostPresent
// Out: events screen (frames carry the device time t) / servo / speaker / hostTx / log / power / tick; clockMs = device clock
//      servo { id, angle, t, pulseUs }: t = device time of the change. speaker { sampleRate, channels, samples, t }: t = device
//      time (ms) when the chunk was taken from the speaker ring; its samples were written at or before t (within one poll).
// description: anything with `channels: { in: [...], out: [...] }` (a device description has it).
import { INPUT_CHANNELS, OUTPUT_CHANNELS } from './channels.mjs';
import { CAMERA_FORMAT, INPUT, MAGIC, PIXEL, POWER, RING, Ring, TOUCH_PHASE, VERSION, W, WORDS } from './io-layout.mjs';

const POLL_MS = 4;

export function createVirtualDevice(descriptor, firmwareFactory, options = {}) {
  return new VirtualDevice(descriptor, firmwareFactory, options);
}

export class VirtualDevice {
  constructor(descriptor, firmwareFactory, { moduleOptions = {}, autoRestart = true } = {}) {
    for (const c of descriptor.channels.in) if (!(c in INPUT_CHANNELS)) throw new Error(`unknown input channel ${c}`);
    for (const c of descriptor.channels.out) if (!(c in OUTPUT_CHANNELS)) throw new Error(`unknown output channel ${c}`);
    this.descriptor = descriptor;
    this.factory = firmwareFactory;
    this.moduleOptions = moduleOptions;
    this.autoRestart = autoRestart;
    this.state = 'off';
    this.bootCount = 0;
    this.listeners = new Map();
    this.logText = '';
    this.lastFrame = null;
    this.cameraSource = null;
    this.hostPresent = false;
    this.micLive = false;
    this._pending = { hostRx: [], mic: [] };
  }

  /** The channels this device declares. */
  get channels() { return this.descriptor.channels; }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  // ---------- lifecycle ----------

  async powerOn() {
    if (this.state !== 'off') throw new Error(`device is already ${this.state}`);
    this.state = 'booting';
    this.bootCount++;
    this.logText = '';
    this.lastFrame = null;
    this._lastSeq = -1;
    const print = (text) => this._appendLog(`${text}\n`);
    this.module = await this.factory({
      print,
      printErr: print,
      // emscripten calls quit on power off; do not let it end the Node process
      quit: () => {},
      ...this.moduleOptions,
    });
    const io = this.module._vdev_io();
    this.heapU8 = this.module.HEAPU8;
    this.heapU32 = this.module.HEAPU32;
    this.ioWord = io >>> 2;
    const word = (k) => this.heapU32[this.ioWord + W[k]];
    if (word('magic') !== MAGIC || word('version') !== VERSION || word('wordCount') !== WORDS) {
      throw new Error('the firmware exchange area does not match io-layout.mjs: rebuild the firmware against this version of esp32-virtual-hardware');
    }
    this.rings = Object.fromEntries(Object.entries(RING).map(([k, i]) => [k, new Ring(this.heapU8, this.heapU32, this.ioWord, i)]));
    this._setWord('hostPresent', this.hostPresent ? 1 : 0);
    this._setWord('micLive', this.micLive ? 1 : 0);
    this._lastCamReq = word('camReqSeq');
    this.state = 'on';
    this.timer = setInterval(() => this._poll(), POLL_MS);
    this.emit('power', { state: 'on', bootCount: this.bootCount });
  }

  async powerOff() {
    if (this.state === 'off') return;
    clearInterval(this.timer);
    this.timer = null;
    try { this._poll(); } catch { /* read the last output if possible */ }
    try { this.module._emscripten_force_exit(0); } catch { /* ExitStatus is expected */ }
    this.module = null;
    this.rings = null;
    this.state = 'off';
    this.emit('power', { state: 'off' });
  }

  /** Power off, then on. */
  async restart() {
    await this.powerOff();
    await this.powerOn();
  }

  // ---------- into the firmware ----------

  pressButton(id, down) {
    const mask = this._word('buttons');
    this._setWord('buttons', down ? (mask | (1 << id)) : (mask & ~(1 << id)));
    this._pushInput(INPUT.button, id, down ? 1 : 0, 0);
  }

  /** x, y in -1..1 */
  setJoystick(x, y) {
    const ix = Math.round(Math.max(-1, Math.min(1, x)) * 1000);
    const iy = Math.round(Math.max(-1, Math.min(1, y)) * 1000);
    this._setWord('joyX', ix >>> 0);
    this._setWord('joyY', iy >>> 0);
    this._pushInput(INPUT.joystick, ix, iy, 0);
  }

  /** phase: 'down' | 'move' | 'up'; x, y in panel pixels (native scan direction) */
  touch(phase, x, y) {
    this._pushInput(INPUT.touch, Math.round(x), Math.round(y), TOUCH_PHASE[phase]);
  }

  /** Microphone PCM (Int16Array, mono, at the device's microphone rate). */
  pushMic(samples) {
    if (!this.rings) return;
    this.rings.mic.write(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength & ~1));
  }

  /** true = real microphone audio is being fed; false = the firmware side fills in low-level noise (firmware watchdogs need live frames). */
  setMicLive(live) {
    this.micLive = !!live;
    if (this.rings) this._setWord('micLive', this.micLive ? 1 : 0);
  }

  /** fn({width, height, format}) → Uint8Array (JPEG…), null, or a Promise of them; called when the firmware wants a frame (it waits up to 500 ms). */
  setCameraSource(fn) { this.cameraSource = fn; }

  /**
   * Bytes from the computer to the device. Also hands out what the device has sent the computer so far (and takes the screen's latest
   * frame, so a panel waiting for its frame to be taken goes on): in a hidden tab the page's poll timer runs about once a second or
   * stalls for 10 s and more, while network events keep arriving, so replies to the computer go out at the latest on its next message.
   */
  hostWrite(bytes) {
    this._pending.hostRx.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    this._flushHostRx();
    this._pumpHostTx();
    if (this.rings) this._pollScreen();
  }

  setHostPresent(present) {
    this.hostPresent = !!present;
    if (this.rings) this._setWord('hostPresent', this.hostPresent ? 1 : 0);
  }

  // ---------- out of the firmware (convenience reads) ----------

  /** The latest screen frame (a copy), or null. */
  get screen() { return this.lastFrame; }

  /** Device clock in ms since power on (the virtual clock for virtual-time devices). */
  get clockMs() { return this._word('clockMs'); }

  /**
   * Virtual-time devices only: let the device run up to device time ms and park it there (the clock stops; every task waits).
   * Inputs given while parked reach the firmware at exactly that time, so the same script of inputs gives the same frames.
   * Resolves with the clock when parked. Call again with a later time to go on, or releaseClock() to run freely.
   */
  async runUntil(ms, timeoutMs = 60_000) {
    if (!this.rings) throw new Error('device is off');
    this._setWord('clockParked', 0);
    this._setWord('clockHoldMs', Math.max(1, Math.floor(ms)));
    await this._waitFor(() => (this._word('clockParked') === 1 && this.clockMs >= ms ? this.clockMs : undefined), timeoutMs, `device parked at ${ms} ms`, 'tick');
    this._poll(); // hand over everything produced up to here before the caller looks
    return this.clockMs;
  }

  /** Let the clock run freely again after runUntil(). */
  releaseClock() { this._setWord('clockHoldMs', 0); }

  /** Wait until the device clock reaches ms. */
  waitForClock(ms, timeoutMs = 60_000) {
    return this._waitFor(() => (this.clockMs >= ms ? this.clockMs : undefined), timeoutMs, `device clock ${ms} ms`, 'tick');
  }

  /** Wait for a log line matching pattern; resolves with the line. */
  waitForLog(pattern, timeoutMs = 10_000) {
    const find = () => this.logText.split('\n').find((l) => pattern.test(l));
    return this._waitFor(() => find(), timeoutMs, `log ${pattern}`, 'log');
  }

  /** Wait for a screen frame matching predicate. */
  waitForScreen(predicate, timeoutMs = 10_000) {
    return this._waitFor(() => (this.lastFrame && predicate(this.lastFrame) ? this.lastFrame : undefined), timeoutMs, 'screen frame', 'screen');
  }

  _waitFor(check, timeoutMs, what, event) {
    const hit = check();
    if (hit !== undefined) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const off = this.on(event, () => {
        const v = check();
        if (v !== undefined) { cleanup(); resolve(v); }
      });
      const t = setTimeout(() => { cleanup(); reject(new Error(`timed out waiting for ${what} (${timeoutMs} ms)`)); }, timeoutMs);
      const cleanup = () => { off(); clearTimeout(t); };
    });
  }

  // ---------- internal ----------

  _word(k) { return this.heapU32 ? Atomics.load(this.heapU32, this.ioWord + W[k]) : 0; }
  _setWord(k, v) { if (this.heapU32) Atomics.store(this.heapU32, this.ioWord + W[k], v >>> 0); }

  _pushInput(type, a, b, c) {
    if (!this.rings) return;
    const rec = new Int32Array([type, a, b, c]);
    this.rings.input.write(new Uint8Array(rec.buffer));
  }

  _flushHostRx() {
    if (!this.rings) return;
    while (this._pending.hostRx.length) {
      const chunk = this._pending.hostRx[0];
      const n = this.rings.hostRx.write(chunk);
      if (n < chunk.length) { this._pending.hostRx[0] = chunk.subarray(n); break; }
      this._pending.hostRx.shift();
    }
  }

  _appendLog(text) {
    this.logText += text;
    if (this.logText.length > 1_000_000) this.logText = this.logText.slice(-500_000);
    this.emit('log', text);
  }

  /** What the device sent the computer since the last look, as one 'hostTx' event. */
  _pumpHostTx() {
    if (!this.rings) return;
    const tx = this.rings.hostTx.drain();
    if (tx) this.emit('hostTx', tx);
  }

  _poll() {
    if (!this.rings) return;
    const r = this.rings;
    const log = r.log.drain();
    if (log) this._appendLog(new TextDecoder().decode(log));
    this._pumpHostTx();
    const servo = r.servo.drain();
    if (servo) {
      const v = new DataView(servo.buffer);
      for (let o = 0; o + 16 <= servo.length; o += 16) {
        this.emit('servo', { id: v.getUint32(o, true), angle: v.getInt32(o + 4, true) / 1000, t: v.getUint32(o + 8, true), pulseUs: v.getUint32(o + 12, true) });
      }
    }
    const spk = r.speaker.drain();
    if (spk) {
      this.emit('speaker', {
        sampleRate: this._word('speakerRate'),
        channels: this._word('speakerChannels'),
        samples: new Int16Array(spk.buffer, 0, spk.length >> 1),
        t: this._word('clockMs'),
      });
    }
    this._flushHostRx();
    this._pollScreen();
    this._pollCamera();
    this.emit('tick', this._word('clockMs'));
    const power = this._word('power');
    if (power === POWER.restart || power === POWER.halted) this._onPowerRequest(power);
  }

  _pollScreen() {
    const seq = this._word('screenSeq');
    const ptr = this._word('screenPtr');
    // seq 0 = the panel registered its memory but the firmware has not committed a frame yet: not a frame. Otherwise whether the poll
    // happens to see this empty frame would make frame-by-frame determinism checks flaky.
    if (!ptr || seq === 0 || seq === this._lastSeq) return;
    this._lastSeq = seq;
    const width = this._word('screenWidth');
    const height = this._word('screenHeight');
    const pixels = new Uint16Array(width * height);
    pixels.set(new Uint16Array(this.heapU8.buffer, ptr, width * height));
    this.lastFrame = { width, height, format: PIXEL[this._word('screenFormat')], pixels, seq, t: this._word('screenTimeMs') };
    this._setWord('screenAck', seq); // tell the firmware this frame was taken (panels that hand over frame by frame continue with the next)
    this.emit('screen', this.lastFrame);
  }

  _pollCamera() {
    const req = this._word('camReqSeq');
    if (req === this._lastCamReq) return;
    this._lastCamReq = req;
    const request = { width: this._word('camReqWidth'), height: this._word('camReqHeight'), format: CAMERA_FORMAT[this._word('camReqFormat')] };
    let bytes;
    try { bytes = this.cameraSource?.(request); } catch { return; }
    // the source may answer asynchronously (canvas JPEG encoding is async); the firmware waits up to 500 ms
    if (bytes && typeof bytes.then === 'function') {
      const module = this.module;
      bytes.then((b) => { if (this.module === module) this._deliverCamera(b); }, () => {});
      return;
    }
    this._deliverCamera(bytes);
  }

  _deliverCamera(bytes) {
    if (!this.rings || !bytes || !bytes.length) return;
    const cap = this._word('camCap');
    if (bytes.length > cap) return;
    this.heapU8.set(bytes, this._word('camBuf'));
    this._setWord('camLen', bytes.length);
    this._setWord('camSeq', this._word('camSeq') + 1);
  }

  async _onPowerRequest(power) {
    if (this._powerBusy) return;
    this._powerBusy = true;
    const reason = this._word('powerReason');
    this.emit('power', { state: power === POWER.restart ? 'restart-requested' : 'halted', reason });
    try {
      await this.powerOff();
      if (power === POWER.restart && this.autoRestart) await this.powerOn();
    } finally {
      this._powerBusy = false;
    }
  }
}

/** Whether a frame is all black. */
export function isAllBlack(frame) {
  for (const p of frame.pixels) if (p !== 0) return false;
  return true;
}
