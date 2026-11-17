// The page's sound: microphone capture lifecycle, with the browser's audio and media APIs replaced by small fakes (no browser).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createAudioIo } from '../src/runtime/audio-io.mjs';

let saved;
let streams;
let sources;

class FakeTrack {
  constructor() { this.readyState = 'live'; this.listeners = {}; }
  stop() { this.readyState = 'ended'; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
class FakeStream {
  constructor() { this.tracks = [new FakeTrack()]; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
const fakeNode = () => ({ connect() {}, disconnect() {} });
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createMediaStreamSource(stream) {
    if (!stream || stream.getTracks().some((t) => t.readyState !== 'live')) throw new Error('no live stream to capture');
    sources.push(stream);
    return fakeNode();
  }
}
class FakeWorkletNode { constructor() { this.port = {}; } connect() {} disconnect() {} }

beforeEach(() => {
  streams = [];
  sources = [];
  saved = Object.fromEntries(['AudioContext', 'AudioWorkletNode', 'addEventListener', 'removeEventListener'].map((k) => [k, globalThis[k]]));
  saved.navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  saved.createObjectURL = URL.createObjectURL;
  saved.revokeObjectURL = URL.revokeObjectURL;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = FakeWorkletNode;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  URL.createObjectURL = () => 'blob:worklet';
  URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => { const s = new FakeStream(); streams.push(s); return s; } } },
  });
});
afterEach(() => {
  for (const k of ['AudioContext', 'AudioWorkletNode', 'addEventListener', 'removeEventListener']) globalThis[k] = saved[k];
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  URL.createObjectURL = saved.createObjectURL;
  URL.revokeObjectURL = saved.revokeObjectURL;
});

const fakeDevice = () => {
  const live = [];
  return { live, on: () => () => {}, pushMic() {}, setMicLive(v) { live.push(v); } };
};

test('switching the microphone on captures the stream it was given, live, and tells the firmware the mic is live', async () => {
  const dev = fakeDevice();
  const states = [];
  const audio = createAudioIo(dev, { onState: (ch, s, detail) => { if (ch === 'mic') states.push(detail ? `${s}:${detail}` : s); } });
  assert.equal(await audio.micOn(), 'on', states.join(' '));
  assert.deepEqual(states, ['starting', 'on']);
  assert.equal(sources.length, 1);
  assert.equal(sources[0], streams[0]);
  assert.equal(streams[0].getTracks()[0].readyState, 'live');
  assert.equal(dev.live.at(-1), true);
  audio.micOff();
  assert.equal(streams[0].getTracks()[0].readyState, 'ended', 'switching off releases the microphone');
  assert.equal(dev.live.at(-1), false);
  audio.dispose();
});

test('switching it on again after off asks for a new stream and captures that one', async () => {
  const audio = createAudioIo(fakeDevice());
  await audio.micOn();
  audio.micOff();
  assert.equal(await audio.micOn(), 'on');
  assert.equal(sources.length, 2);
  assert.equal(sources[1], streams[1]);
  assert.equal(streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(streams[1].getTracks()[0].readyState, 'live');
  audio.dispose();
  assert.equal(streams[1].getTracks()[0].readyState, 'ended');
});

// Permission prompts answered later: each getUserMedia call waits until the test answers it, in any order.
function holdPermissionRequests() {
  const pending = [];
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    const s = new FakeStream();
    streams.push(s);
    pending.push(() => resolve(s));
  });
  return pending;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

for (const order of [[0, 1], [1, 0]]) {
  test(`on, off, on while both requests are pending (answered ${order.join(' then ')}): only the last stream stays, live and captured`, async () => {
    const dev = fakeDevice();
    const states = [];
    const audio = createAudioIo(dev, { onState: (ch, s) => { if (ch === 'mic') states.push(s); } });
    const answer = holdPermissionRequests();
    const first = audio.micOn();
    audio.micOff();
    const second = audio.micOn();
    for (const i of order) { answer[i](); await settle(); }
    await Promise.all([first, second]);
    assert.equal(audio.micState, 'on', states.join(' '));
    assert.equal(streams[0].getTracks()[0].readyState, 'ended', 'the stale stream is released');
    assert.equal(streams[1].getTracks()[0].readyState, 'live');
    assert.deepEqual(sources, [streams[1]]);
    assert.equal(dev.live.at(-1), true);
    audio.micOff();
    assert.equal(streams[1].getTracks()[0].readyState, 'ended', 'switching off reaches the current stream');
    audio.dispose();
  });
}

test('dispose while the permission request is pending: the late stream is released and the mic never goes live', async () => {
  const dev = fakeDevice();
  const audio = createAudioIo(dev);
  const answer = holdPermissionRequests();
  const pending = audio.micOn();
  audio.dispose();
  answer[0]();
  await pending;
  assert.equal(streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(sources.length, 0);
  assert.ok(!dev.live.includes(true));
});
