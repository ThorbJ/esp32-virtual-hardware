// Sound of a virtual device page: the interface's speaker channel → WebAudio; the computer's microphone (getUserMedia) →
// the interface's mic channel. Device independent; browser only. Reports states, never words (the page owns its text).
//
// Echo cancellation, noise suppression and gain are the browser microphone's own (they stand in for the chip's audio front end).
// While the microphone is off, refused or taken away, setMicLive(false): the firmware side fills in low-level noise, so firmware
// microphone watchdogs do not restart the device.
//
//   const audio = createAudioIo(dev, { micRate: 16000, onState });
//   await audio.micOn();  audio.micOff();  audio.feedUrl(url) (test hook: an audio file as the microphone)
//   onState('speaker', 'locked' | 'running'); onState('mic', 'off' | 'starting' | 'on' | 'feeding' | 'denied' | 'error', detail)

const FRAME_MS = 20;

// AudioWorklet: cuts the input (already at the context rate = the firmware's mic rate) into 20 ms 16-bit frames.
const WORKLET = `
class MicCapture extends AudioWorkletProcessor {
  constructor(opts) { super(); this.frame = opts.processorOptions.frame; this.buf = new Int16Array(this.frame); this.fill = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.fill++] = v < 0 ? v * 32768 : v * 32767;
      if (this.fill === this.frame) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Int16Array(this.frame); this.fill = 0; }
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
`;

export function createAudioIo(dev, { micRate = 16000, onState = () => {} } = {}) {
  // ---------- speaker ----------
  const out = new AudioContext({ latencyHint: 'interactive' });
  let nextTime = 0;
  let speakerFrames = 0;
  const LEAD = 0.08; // 80 ms jitter buffer
  const offSpeaker = dev.on('speaker', ({ sampleRate, channels, samples }) => {
    if (out.state !== 'running' || !sampleRate || !samples.length) return;
    const ch = Math.max(1, channels);
    const frames = Math.floor(samples.length / ch);
    const buf = out.createBuffer(ch, frames, sampleRate);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) d[i] = samples[i * ch + c] / 32768;
    }
    const src = out.createBufferSource();
    src.buffer = buf;
    src.connect(out.destination);
    const now = out.currentTime;
    if (nextTime < now + 0.01 || nextTime > now + 1) nextTime = now + LEAD; // gap or too much queued: realign
    src.start(nextTime);
    nextTime += frames / sampleRate;
    speakerFrames += frames;
  });
  const resumeSpeaker = () => (out.state === 'running' ? Promise.resolve() : out.resume());
  // Autoplay policy: sound only after the first click or key press on the page
  const unlock = () => {
    resumeSpeaker().then(() => {
      if (out.state !== 'running') return;
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
      onState('speaker', 'running');
    });
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
  onState('speaker', out.state === 'running' ? 'running' : 'locked');

  // ---------- microphone ----------
  let micCtx = null;
  let micStream = null;
  let micNodes = [];
  let micFrames = 0;
  let state = 'off';
  const setState = (s, detail) => { state = s; onState('mic', s, detail); };

  async function pipeline(build) {
    stopCapture();
    micCtx = new AudioContext({ sampleRate: micRate, latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await micCtx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(micCtx, 'mic-capture', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { frame: (micRate * FRAME_MS) / 1000 } });
    node.port.onmessage = (e) => { if (state === 'on' || state === 'feeding') { dev.pushMic(e.data); micFrames++; } };
    const source = await build(micCtx);
    source.connect(node);
    micNodes = [source, node];
    await micCtx.resume();
  }

  function stopCapture() {
    dev.setMicLive(false);
    for (const n of micNodes) { try { n.disconnect(); } catch { /* already */ } }
    micNodes = [];
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    micCtx?.close().catch(() => {});
    micCtx = null;
  }

  async function micOn() {
    if (state === 'on' || state === 'starting') return state;
    setState('starting');
    resumeSpeaker().catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) { setState('error', 'unsupported'); return state; }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      if (state !== 'starting') return state;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setState(denied ? 'denied' : 'error', err?.name ?? String(err));
      return state;
    }
    if (state !== 'starting') { micStream.getTracks().forEach((t) => t.stop()); micStream = null; return state; } // switched off meanwhile
    micStream.getAudioTracks()[0]?.addEventListener('ended', () => { stopCapture(); setState('denied', 'ended'); });
    try {
      await pipeline((ctx) => ctx.createMediaStreamSource(micStream));
    } catch (err) {
      stopCapture();
      setState('error', err?.message ?? String(err));
      return state;
    }
    state = 'on';
    dev.setMicLive(true);
    setState('on');
    return state;
  }

  function micOff() { stopCapture(); setState('off'); }

  /** Test hook: play an audio file (any rate) into the microphone channel through the same capture path; back to off when done. */
  async function feedUrl(url, { gain = 1 } = {}) {
    const bytes = await fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.arrayBuffer(); });
    let ended;
    const done = new Promise((r) => { ended = r; });
    if (state === 'on') stopCapture();
    setState('feeding');
    await pipeline(async (ctx) => {
      const buffer = await ctx.decodeAudioData(bytes);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      src.onended = () => ended();
      src.start();
      return g;
    });
    dev.setMicLive(true);
    await done;
    await new Promise((r) => setTimeout(r, 200));
    stopCapture();
    setState('off');
  }

  return {
    micOn, micOff, feedUrl,
    get micState() { return state; },
    get speakerState() { return out.state === 'running' ? 'running' : 'locked'; },
    stats: () => ({ micFrames, speakerFrames, speaker: out.state, mic: state }),
    dispose() {
      stopCapture();
      offSpeaker();
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
      out.close().catch(() => {});
    },
  };
}
