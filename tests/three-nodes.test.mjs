// The reference viewer's node handling on a real three.js scene loaded by GLTFLoader (Node, no WebGL): the screen face found
// through unnamed nodes and primitives, turns and offsets given in Kit model coordinates although the nodes sit under a rotated
// group (like the Brufik Kit model), joints mounted on joints, hidden nodes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNodeControls } from '../src/runtime/three-nodes.mjs';
import { kitGlb } from '../test-device/model.mjs';
import { glbJson } from '../device-description/validate.mjs';

/** The test device model rearranged like a CAD export: everything under an unnamed group turned -90° about X (Z-up → Y-up). */
function cadLikeGlb() {
  const src = kitGlb();
  const json = glbJson(src);
  const jl = new DataView(src.buffer).getUint32(12, true);
  const bin = src.subarray(20 + jl); // the BIN chunk with its header
  const [caseN, screenN, buttonN, servoN, armN] = json.nodes;
  // The box nodes keep their Y-up positions in Kit model coordinates; under the group they are stored Z-up: (x, y, z) → (x, -z, y).
  const zUp = (n) => ({ ...n, translation: [n.translation[0], -n.translation[2], n.translation[1]], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
  const s = Math.SQRT1_2;
  const edge = json.meshes.push({ primitives: [json.meshes[1].primitives[0], { ...json.meshes[0].primitives[0], attributes: { POSITION: json.meshes[0].primitives[0].attributes.POSITION } }] }) - 1;
  json.nodes = [
    { rotation: [-s, 0, 0, s], children: [1, 2, 5, 6, 7, 8, 9] },          // 0 unnamed group
    zUp(caseN),                                                             // 1 case
    { name: 'lcd', children: [3] },                                         // 2
    { children: [4] },                                                      // 3 unnamed
    { ...zUp(screenN), name: undefined },                                   // 4 the face mesh (unnamed)
    zUp(buttonN),                                                           // 5 button
    zUp(servoN),                                                            // 6 servo
    zUp(armN),                                                              // 7 arm
    { name: 'glass', mesh: edge, translation: [0, -40, 0] },                // 8 two primitives: face, edge
    { name: 'frame-001', mesh: 1, translation: [0, 0, 100] },               // 9 a welcome-animation plane
  ];
  json.scenes = [{ nodes: [0] }];
  const jb = new TextEncoder().encode(JSON.stringify(json));
  const pad = (n) => (n + 3) & ~3;
  const out = new Uint8Array(20 + pad(jb.length) + bin.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, pad(jb.length), true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20); out.fill(0x20, 20 + jb.length, 20 + pad(jb.length));
  out.set(bin, 20 + pad(jb.length));
  return out;
}

async function load() {
  const glb = cadLikeGlb();
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  return { model, nodes: createNodeControls(THREE, model, gltf.parser) };
}
const centre = (model, o) => {
  model.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  return c.applyMatrix4(model.matrixWorld.clone().invert()).toArray().map((v) => Math.round(v * 1000) / 1000 + 0);
};
const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

test('the arm sits where the test device has it, in Kit model coordinates, although stored under a rotated group', async () => {
  const { model } = await load();
  assert.deepEqual(centre(model, model.getObjectByName('arm')), [20, 69, 9]);
});

test('a turn about a Kit model axis moves the node about that axis, not about its parent axes', async () => {
  const { model, nodes } = await load();
  const arm = model.getObjectByName('arm');
  // arm centre (20, 69, 9), pivot (20, 69, 0), 90° about +Y: (0, 0, 9) → (9, 0, 0)
  nodes.setRotation(['arm'], [{ pivot: [20, 69, 0], axis: [0, 1, 0], angleDeg: 90 }]);
  assert.deepEqual(centre(model, arm), [29, 69, 0]);
  nodes.setRotation(['arm'], [{ pivot: [20, 69, 0], axis: [0, 1, 0], angleDeg: 0 }]);
  assert.deepEqual(centre(model, arm), [20, 69, 9]);
});

test('turns are applied in order: the own joint first, then the joint it rides on, each about its place in the Kit model', async () => {
  const { model, nodes } = await load();
  const button = model.getObjectByName('button'); // centre (0, 8, 16)
  // own joint: 90° about +X through (0, 8, 0): (0, 0, 16) → (0, -16, 0) → centre (0, -8, 0)
  // then the parent joint: 90° about +Y through the origin: (0, -8, 0) stays (on the axis)… use 90° about +Z: (0, -8, 0) → (8, 0, 0)
  nodes.setRotation(['button'], [{ pivot: [0, 8, 0], axis: [1, 0, 0], angleDeg: 90 }, { pivot: [0, 0, 0], axis: [0, 0, 1], angleDeg: 90 }]);
  assert.deepEqual(centre(model, button), [8, 0, 0]);
});

test('an unnamed node reached by path from a named one turns like a named one', async () => {
  const { model, nodes } = await load();
  const face = model.getObjectByName('lcd').children[0].children[0]; // centre (0, 36, 15.5)
  nodes.setRotation([{ node: 'lcd', path: [0, 0] }], [{ pivot: [0, 36, 0], axis: [0, 1, 0], angleDeg: 90 }]);
  assert.deepEqual(centre(model, face), [15.5, 36, 0]);
});

test('a pivot given as a node is that node\'s centre where the Kit model has it, even after the node has moved', async () => {
  const { model, nodes } = await load();
  nodes.setOffset(['servo'], [0, 100, 0]);
  nodes.setRotation(['arm'], [{ pivot: { node: 'servo' }, axis: [0, 1, 0], angleDeg: 180 }]); // servo centre (20, 64, 0)
  assert.deepEqual(centre(model, model.getObjectByName('arm')), [20, 69, -9]);
});

test('an offset is in Kit model coordinates; null puts the node back', async () => {
  const { model, nodes } = await load();
  const button = model.getObjectByName('button');
  nodes.setOffset(['button'], [0, 0, -1.5]);
  assert.deepEqual(centre(model, button), [0, 8, 14.5]);
  nodes.setOffset(['button'], null);
  assert.deepEqual(centre(model, button), [0, 8, 16]);
});

test('the screen image goes on the face: down the face path through unnamed nodes, or onto one primitive', async () => {
  const { model, nodes } = await load();
  const lcd = model.getObjectByName('lcd');
  nodes.setScreenImage({ node: 'lcd', face: { path: [0, 0] } }, image);
  const face = lcd.children[0].children[0];
  assert.ok(face.isMesh && face.material.map?.isDataTexture);
  assert.equal(face.material.map.flipY, false);

  nodes.setScreenImage({ node: 'glass', face: { primitive: 1 } }, image);
  const [p0, p1] = model.getObjectByName('glass').children;
  assert.ok(!p0.material.map && p1.material.map?.isDataTexture);
  assert.throws(() => nodes.setScreenImage({ node: 'lcd', face: { path: [3] } }, image), /face/);
});

test('hidden patterns hide every matching node until shown again', async () => {
  const { model, nodes } = await load();
  nodes.setHidden(['frame-*', 'case'], true);
  assert.equal(model.getObjectByName('frame-001').visible, false);
  assert.equal(model.getObjectByName('case').visible, false);
  assert.equal(model.getObjectByName('arm').visible, true);
  nodes.setHidden(['frame-*', 'case'], false);
  assert.equal(model.getObjectByName('frame-001').visible, true);
});
