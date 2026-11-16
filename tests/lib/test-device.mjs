// Test helpers: power on the test device from its committed package (unpacked to a temporary folder), in Node.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPackage } from '../../src/package/index.mjs';
import { createVirtualDevice } from '../../src/interface/virtual-device.mjs';
import { loadFirmwareFile } from '../../src/interface/node-loader.mjs';

export const FIXTURE = fileURLToPath(new URL('../../fixtures/test-device/test-device.vdpkg.tgz', import.meta.url));

let unpacked = null;
/** The fixture package unpacked once per process: { dir, description, files }. */
export async function unpackFixture() {
  if (unpacked) return unpacked;
  const { description, files } = await readPackage(new Uint8Array(readFileSync(FIXTURE)));
  const dir = mkdtempSync(path.join(tmpdir(), 'vhw-test-device-'));
  for (const [p, bytes] of files) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), bytes);
  }
  unpacked = { dir, description, files };
  return unpacked;
}

/** A powered-on test device and the frames it has shown: { dev, frames, servo, tx }. */
export async function powerOnTestDevice() {
  const { dir, description } = await unpackFixture();
  const dev = createVirtualDevice(description, await loadFirmwareFile(path.join(dir, description.runtime.module)));
  const frames = [];
  const servo = [];
  const tx = [];
  dev.on('screen', (f) => frames.push({ t: f.t, hash: frameHash(f) }));
  dev.on('servo', (s) => servo.push(s));
  dev.on('hostTx', (b) => tx.push(...b));
  await dev.powerOn();
  return { dev, frames, servo, tx };
}

export const frameHash = (f) => createHash('sha1').update(new Uint8Array(f.pixels.buffer, f.pixels.byteOffset, f.pixels.byteLength)).digest('hex').slice(0, 16);

/** RGB565 → [r, g, b] 0..255 of pixel (x, y). */
export function pixel(frame, x, y) {
  const p = frame.pixels[y * frame.width + x];
  return [((p >> 11) & 31) * 255 / 31, ((p >> 5) & 63) * 255 / 63, (p & 31) * 255 / 31].map(Math.round);
}
