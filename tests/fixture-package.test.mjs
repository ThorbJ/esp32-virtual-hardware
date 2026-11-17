// The committed test device package passes the same checks a shop applies to any package.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkNodesInModel, checkPackageFiles, glbNodeNames, nodeNameMatches, PACKAGE_MAX_BYTES, validateDeviceDescription } from '../device-description/validate.mjs';
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
  assert.deepEqual(checkNodesInModel(description, glb), []);
  for (const l of manifest.lines) for (const n of l.nodes) assert.ok(names.includes(n), n);
});

// A small glTF document like the Brufik and HachimoDock Kit models: a rotated unnamed group, a named screen node whose face is
// an unnamed mesh a few levels down, a mesh with two primitives (face + edge), and welcome-animation planes over the face.
const uv = { POSITION: 0, TEXCOORD_0: 1 };
const noUv = { POSITION: 0 };
const model = () => ({
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 53, 0, 1], children: [1, 6, 7, 8] }, // 0: unnamed rotated group
    { name: 'lcd', children: [2] },                                                     // 1
    { name: 'lcd-module', children: [3, 4] },                                            // 2
    { mesh: 0 },                                                                         // 3: bezel, no texture coordinates
    { children: [5] },                                                                   // 4
    { mesh: 1 },                                                                         // 5: the face
    { name: 'touch-glass', mesh: 2 },                                                    // 6: primitive 0 face, 1 edge
    { name: 'official-screen-frame-001', mesh: 1 },                                      // 7
    { name: 'arm', mesh: 0 },                                                            // 8
  ],
  meshes: [
    { primitives: [{ attributes: noUv }] },
    { primitives: [{ attributes: uv }] },
    { primitives: [{ attributes: uv }, { attributes: noUv }] },
  ],
});
const base = { screen: { node: 'lcd', face: { path: [0, 1, 0] } }, servos: [{ nodes: ['arm'], pivot: [0, 0, 0] }] };
const check = (d, m = model()) => checkNodesInModel(d, m).map((i) => `${i.path} ${i.rule}`);

test('a node missing from the model is reported for each place that uses it', () => {
  const issues = check({ screen: { node: 'lcd2' }, inputs: [{ kind: 'touch', node: 'lcd2' }], servos: [{ nodes: ['arm', 'neck'], pivot: { node: 'hub' } }] });
  assert.deepEqual(issues, ['screen.node unknown_node', 'inputs[0].node unknown_node', 'servos[0].nodes[1] unknown_node', 'servos[0].pivot.node unknown_node']);
});

test('the screen face: a child index path from the screen node to a mesh with texture coordinates, and its primitive', () => {
  assert.deepEqual(check(base), []);
  assert.deepEqual(check({ screen: { node: 'touch-glass', face: { primitive: 0 } } }), []);
  assert.deepEqual(check({ screen: { node: 'touch-glass' } }), [], 'no face: the screen node itself, primitive 0');
  assert.deepEqual(check({ screen: { node: 'lcd', face: { path: [0, 2, 0] } } }), ['screen.face.path bad_screen_face'], 'no such child');
  assert.deepEqual(check({ screen: { node: 'lcd', face: { path: [0, 0] } } }), ['screen.face bad_screen_face'], 'the bezel has no texture coordinates');
  assert.deepEqual(check({ screen: { node: 'lcd' } }), ['screen.face bad_screen_face'], 'the screen node has no mesh');
  assert.deepEqual(check({ screen: { node: 'touch-glass', face: { primitive: 1 } } }), ['screen.face bad_screen_face'], 'the edge has no texture coordinates');
  assert.deepEqual(check({ screen: { node: 'touch-glass', face: { primitive: 2 } } }), ['screen.face.primitive bad_screen_face']);
});

test('the same check reads GLB bytes; a list of names is refused (the face needs the model)', () => {
  const d = { screen: { node: 'screen' }, servos: [{ nodes: ['arm'], pivot: { node: 'servo' } }] };
  assert.deepEqual(checkNodesInModel(d, glb), []);
  assert.deepEqual(checkNodesInModel({ screen: { node: 'screen', face: { path: [0] } } }, glb).map((i) => i.rule), ['bad_screen_face']);
  assert.throws(() => checkNodesInModel(d, ['screen', 'arm']), /GLB/);
});

test('a servo node given by path from a named node must lead to a node', () => {
  assert.deepEqual(check({ servos: [{ nodes: [{ node: 'lcd', path: [0, 1] }, { node: 'lcd', path: [0, 2] }, { node: 'pack', path: [0] }], pivot: [0, 0, 0] }] }),
    ['servos[0].nodes[1] unknown_node', 'servos[0].nodes[2] unknown_node']);
});

test('every hide pattern must match at least one node; * matches any run of characters', () => {
  assert.deepEqual(check({ hide: ['official-screen-frame-*', 'lcd-*', '*glass', 'arm'] }), []);
  assert.deepEqual(check({ hide: ['official-frame-*', 'ar'] }), ['hide[0] unknown_node', 'hide[1] unknown_node']);
  assert.equal(nodeNameMatches('official-screen-frame-*', 'official-screen-frame-117'), true);
  assert.equal(nodeNameMatches('a*c', 'abbc'), true);
  assert.equal(nodeNameMatches('a*c', 'abcd'), false);
  assert.equal(nodeNameMatches('a.c', 'abc'), false, 'only * is special');
});

test('glbNodeNames refuses what is not a GLB', () => {
  assert.throws(() => glbNodeNames(new Uint8Array(20)), /not a GLB/);
});
