// The committed test device package passes the same checks a shop applies to any package.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkNodesInModel, checkPackageFiles, glbNodeNames, PACKAGE_MAX_BYTES, validateDeviceDescription } from '../device-description/validate.mjs';
import { readPackage } from '../src/package/index.mjs';
import { FIXTURE } from './lib/test-device.mjs';

const glb = new Uint8Array(readFileSync(new URL('../fixtures/test-device/kit.glb', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../fixtures/test-device/kit-manifest.json', import.meta.url), 'utf8'));

test('the fixture package: valid description, files as listed, small', async () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  assert.ok(bytes.length < 200_000 && bytes.length < PACKAGE_MAX_BYTES, `${bytes.length} bytes`);
  const { description, files } = await readPackage(bytes);
  assert.deepEqual(validateDeviceDescription(description).issues, []);
  assert.deepEqual(await checkPackageFiles(description, files), []);
  assert.equal(description.device.id, 'test-device');
});

test('every node the description points at is in the fixture Kit model, and the manifest names only model nodes', async () => {
  const { description } = await readPackage(new Uint8Array(readFileSync(FIXTURE)));
  const names = glbNodeNames(glb);
  assert.deepEqual(names, ['case', 'screen', 'button', 'servo', 'arm']);
  assert.deepEqual(checkNodesInModel(description, names), []);
  for (const l of manifest.lines) for (const n of l.nodes) assert.ok(names.includes(n), n);
});

test('a node missing from the model is reported for each place that uses it', () => {
  const issues = checkNodesInModel({ screen: { node: 'lcd' }, inputs: [{ kind: 'touch', node: 'lcd' }], servos: [{ nodes: ['arm'], pivot: { node: 'hub' } }] }, ['arm']);
  assert.deepEqual(issues.map((i) => `${i.path} ${i.rule}`), ['screen.node unknown_node', 'inputs[0].node unknown_node', 'servos[0].pivot.node unknown_node']);
});

test('glbNodeNames refuses what is not a GLB', () => {
  assert.throws(() => glbNodeNames(new Uint8Array(20)), /not a GLB/);
});
