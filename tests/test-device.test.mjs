// The test device, driven through the virtual device interface in Node (no browser), from its committed package.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { isAllBlack } from '../src/interface/virtual-device.mjs';
import { pixel, powerOnTestDevice } from './lib/test-device.mjs';

const devices = [];
after(async () => { for (const d of devices) await d.dev.powerOff(); });
const start = async () => { const d = await powerOnTestDevice(); devices.push(d); return d; };

test('boots: logs its version and the screen stops being black', async () => {
  const { dev } = await start();
  await dev.waitForLog(/test-device: boot v0\.1\.0/);
  const frame = await dev.waitForScreen((f) => !isAllBlack(f), 10_000);
  assert.equal(frame.width, 160);
  assert.equal(frame.height, 128);
  const [r, g, b] = pixel(frame, 80, 100); // background below the moving square: blue before any press
  assert.ok(b > 200 && r < 40 && g < 40, `blue background, got ${[r, g, b]}`);
  await dev.powerOff();
});

test('the screen keeps changing: new frames over one second of device time', async () => {
  const { dev, frames } = await start();
  await dev.runUntil(1500);
  const shown = new Set(frames.filter((f) => f.t >= 500).map((f) => f.hash));
  assert.ok(shown.size >= 5, `distinct frames between 0.5 s and 1.5 s: ${shown.size}`);
  await dev.powerOff();
});

test('a button press changes the picture and turns the servo', async () => {
  const { dev, servo } = await start();
  await dev.runUntil(600);
  assert.ok(Math.abs(servo.at(-1).angle - 90) < 0.5, `servo at boot ${servo.at(-1)?.angle}`); // 14-bit PWM: within half a degree
  dev.pressButton(0, true);
  await dev.runUntil(700);
  dev.pressButton(0, false);
  await dev.runUntil(900);
  const [r, g, b] = pixel(dev.screen, 80, 100);
  assert.ok(r > 200 && b < 40, `orange background after the press, got ${[r, g, b]}`);
  assert.ok(Math.abs(servo.at(-1).angle - 150) < 0.5, `servo after the press ${servo.at(-1).angle}`);
  assert.ok(Math.abs(servo.at(-1).pulseUs - 2167) <= 1, `pulse ${servo.at(-1).pulseUs}`); // 500 + 150/180 × 2000 µs
  await dev.waitForLog(/button pressed \(1\)/);
  await dev.powerOff();
});

test('bytes from the computer come straight back', async () => {
  const { dev, tx } = await start();
  await dev.waitForLog(/boot/);
  dev.setHostPresent(true);
  dev.hostWrite(new TextEncoder().encode('hello\x00\xff'));
  const deadline = Date.now() + 5000;
  while (tx.length < 7 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(tx, [...new TextEncoder().encode('hello\x00\xff')]);
  await dev.powerOff();
});

test('nothing goes to the computer while it is not there', async () => {
  const { dev, tx } = await start();
  await dev.waitForLog(/boot/);
  dev.hostWrite(new TextEncoder().encode('lost'));
  await dev.runUntil(800);
  assert.deepEqual(tx, []);
  await dev.powerOff();
});

test('determinism: the same inputs at the same device times give the same frames', async () => {
  const run = async () => {
    const { dev, frames } = await start();
    for (const [t, down] of [[400, true], [450, false], [1200, true], [1230, false]]) {
      await dev.runUntil(t);
      dev.pressButton(0, down);
    }
    await dev.runUntil(2000);
    await dev.powerOff();
    return frames.filter((f) => f.t <= 2000).map((f) => `${f.t}:${f.hash}`);
  };
  const a = await run();
  const b = await run();
  assert.ok(a.length >= 15, `frames up to 2 s: ${a.length}`);
  assert.deepEqual(a, b);
});
