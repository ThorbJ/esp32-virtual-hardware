import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPackage, readPackage } from '../src/package/index.mjs';
import { checkPackageFiles, validateDeviceDescription } from '../device-description/validate.mjs';
import { sample } from './sample-description.mjs';

const enc = (s) => new TextEncoder().encode(s);
const firmwareFiles = () => new Map([
  ['firmware/test-device.mjs', enc('export default 1;\n')],
  ['firmware/test-device.wasm', new Uint8Array(1000).map((_, i) => i & 255)],
  ['licenses/LICENSE', enc('MIT\n')],
]);
const template = () => { const d = sample(); delete d.files; return d; };

test('a built package reads back: description with sizes and sha256, every file byte for byte', async () => {
  const { archive, description } = await buildPackage({ description: template(), files: firmwareFiles() });
  assert.deepEqual(validateDeviceDescription(description).issues, []);
  const back = await readPackage(archive);
  assert.deepEqual(back.description, description);
  assert.deepEqual([...back.files.keys()].sort(), ['firmware/test-device.mjs', 'firmware/test-device.wasm', 'licenses/LICENSE']);
  assert.deepEqual(back.files.get('firmware/test-device.wasm'), firmwareFiles().get('firmware/test-device.wasm'));
  assert.deepEqual(await checkPackageFiles(back.description, back.files), []);
  const wasm = description.files.find((f) => f.path === 'firmware/test-device.wasm');
  assert.equal(wasm.size, 1000);
  assert.equal(wasm.sha256, 'a8af099bf2e878609558dbf69d8f88f4a31040a8cf84b549a0cfa912f12ffc3f'); // python hashlib, bytes 0..255 repeating
});

test('building twice gives the same archive bytes', async () => {
  const a = await buildPackage({ description: template(), files: firmwareFiles() });
  const b = await buildPackage({ description: template(), files: firmwareFiles() });
  assert.deepEqual(a.archive, b.archive);
});

test('a description that does not validate is refused when building', async () => {
  const d = template();
  delete d.firmware.license;
  await assert.rejects(buildPackage({ description: d, files: firmwareFiles() }), /firmware\.license/);
});

test('tampered, missing and extra files are reported', async () => {
  const { description } = await buildPackage({ description: template(), files: firmwareFiles() });
  const files = firmwareFiles();
  files.set('firmware/test-device.mjs', enc('export default 2;\n'));
  files.delete('licenses/LICENSE');
  files.set('firmware/extra.js', enc('x'));
  const rules = (await checkPackageFiles(description, files)).map((i) => `${i.path} ${i.rule}`);
  assert.deepEqual(rules.sort(), ['files file_unlisted', 'files[0].sha256 sha256_mismatch', 'files[2] file_missing'].sort());
});

test('an archive without device.json, or not an archive, is refused with a reason', async () => {
  await assert.rejects(readPackage(enc('hello')), /not a package archive/);
});
