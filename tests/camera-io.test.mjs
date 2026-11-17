// The page's camera: capture lifecycle, with getUserMedia and the video element replaced by small fakes (no browser).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createCameraIo } from '../src/runtime/camera-io.mjs';

let saved;
let streams;
let pending;
let plays;

class FakeTrack {
  constructor() { this.readyState = 'live'; }
  stop() { this.readyState = 'ended'; }
  addEventListener() {}
}
class FakeStream {
  constructor() { this.tracks = [new FakeTrack()]; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks; }
}
// video.play() waits until the test lets it finish, like a real camera warming up.
class FakeVideo {
  constructor() { this.srcObject = null; }
  play() { return new Promise((resolve) => plays.push(resolve)); }
}

beforeEach(() => {
  streams = [];
  pending = [];
  plays = [];
  saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { const s = new FakeStream(); streams.push(s); pending.push(() => resolve(s)); }) } },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeVideo() } });
});
afterEach(() => {
  for (const k of ['navigator', 'document']) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k];
  }
});

const fakeDevice = () => ({ setCameraSource() {} });
const settle = () => new Promise((r) => setTimeout(r, 0));
const live = (i) => streams[i].getTracks()[0].readyState === 'live';

test('switching the camera on plays the stream and off releases it', async () => {
  const camera = createCameraIo(fakeDevice());
  const on = camera.cameraOn();
  pending[0](); await settle();
  plays[0](); 
  assert.equal(await on, 'on');
  assert.ok(live(0));
  camera.cameraOff();
  assert.ok(!live(0));
  camera.dispose();
});

for (const order of [[0, 1], [1, 0]]) {
  test(`on, off, on while both are starting (answered ${order.join(' then ')}): only the last stream stays live`, async () => {
    const camera = createCameraIo(fakeDevice());
    const first = camera.cameraOn();
    camera.cameraOff();
    const second = camera.cameraOn();
    for (const i of order) { pending[i](); await settle(); }
    for (const p of plays) p();
    await Promise.all([first, second]);
    assert.equal(camera.state, 'on');
    assert.ok(!live(0), 'the stale stream is released');
    assert.ok(live(1));
    camera.cameraOff();
    assert.ok(!live(1), 'switching off reaches the current stream');
    camera.dispose();
  });
}

test('off while the video is still starting: the late start does not switch it back on', async () => {
  const camera = createCameraIo(fakeDevice());
  const on = camera.cameraOn();
  pending[0](); await settle();
  camera.cameraOff();
  plays[0]();
  await on;
  assert.equal(camera.state, 'off');
  assert.ok(!live(0));
  camera.dispose();
});

test('dispose while the permission request is pending: the late stream is released', async () => {
  const states = [];
  const camera = createCameraIo(fakeDevice(), { onState: (_, s) => states.push(s) });
  const on = camera.cameraOn();
  camera.dispose();
  pending[0](); await settle();
  for (const p of plays) p();
  await on;
  assert.ok(!live(0));
  assert.ok(!states.includes('on'), states.join(' '));
});
