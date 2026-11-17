import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateDeviceDescription, referencedNodes, FORMAT_VERSION } from '../device-description/validate.mjs';
import { sample } from './sample-description.mjs';

const rules = (d) => validateDeviceDescription(d).issues.map((i) => `${i.path} ${i.rule}`);

test('a complete description is accepted', () => {
  const r = validateDeviceDescription(sample());
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.equal(FORMAT_VERSION, 2);
});

test('missing source, license and kit are each reported', () => {
  const d = sample();
  delete d.firmware.upstream;
  delete d.firmware.license;
  delete d.appliesTo.kit;
  const r = rules(d);
  assert.ok(r.includes('firmware.upstream required'), r.join('\n'));
  assert.ok(r.includes('firmware.license required'));
  assert.ok(r.includes('appliesTo.kit required'));
});

test('an unknown format version is rejected, format 1 included', () => {
  assert.deepEqual(rules({ ...sample(), formatVersion: 3 }), ['formatVersion unsupported_version']);
  assert.deepEqual(rules({ ...sample(), formatVersion: 1 }), ['formatVersion unsupported_version']);
});

test('format 1 materialIndex is gone: the face selector replaces it', () => {
  const d = sample();
  d.screen.materialIndex = 0;
  assert.deepEqual(rules(d), ['screen.materialIndex unknown_field']);
});

test('the screen face: a child index path under the screen node and a primitive, both optional', () => {
  const d = sample();
  d.screen.face = { path: [0, 17, 0], primitive: 0 };
  assert.deepEqual(rules(d), []);
  d.screen.face = {};
  assert.deepEqual(rules(d), []);
  d.screen.face = { path: [0, -1, 1.5], primitive: 'x', name: 'glass' };
  assert.deepEqual(rules(d), ['screen.face.name unknown_field', 'screen.face.path[1] range', 'screen.face.path[2] type', 'screen.face.primitive type']);
});

test('the screen picture can be mirrored after it is turned', () => {
  const d = sample();
  d.screen.flipX = false;
  d.screen.flipY = true;
  assert.deepEqual(rules(d), []);
  d.screen.flipY = 1;
  assert.deepEqual(rules(d), ['screen.flipY type']);
});

test('a servo joint can ride on another servo joint (parent), never on itself or in a loop', () => {
  const d = sample();
  d.servos.push({ id: 1, parent: 0, nodes: ['head'], pivot: [0, 87, -2], axis: [1, 0, 0], zeroDeg: 90, direction: 1, scale: 1 });
  assert.deepEqual(rules(d), []);
  d.servos[1].parent = 5;
  assert.deepEqual(rules(d), ['servos[1].parent unknown_servo']);
  d.servos[1].parent = 1;
  assert.deepEqual(rules(d), ['servos[1].parent servo_cycle']);
  d.servos[1].parent = 0;
  d.servos[0].parent = 1;
  assert.deepEqual(rules(d), ['servos[0].parent servo_cycle', 'servos[1].parent servo_cycle']);
});

test('a node is turned by one servo only (a child joint already carries its nodes along with its parent)', () => {
  const d = sample();
  d.servos.push({ id: 1, parent: 0, nodes: ['head', 'arm'], pivot: [0, 87, -2], axis: [1, 0, 0], zeroDeg: 90, direction: 1, scale: 1 });
  assert.deepEqual(rules(d), ['servos[1].nodes[1] duplicate']);
});

test('a servo can turn unnamed parts: { node, path } reaches them from a named node by glTF child indexes', () => {
  const d = sample();
  d.servos[0].nodes.push({ node: 'internal-pack', path: [9] }, { node: 'internal-pack', path: [10, 0] });
  assert.deepEqual(rules(d), []);
  d.servos[0].nodes.push({ node: 'internal-pack', path: [9] }, { node: 'internal-pack', path: [] }, { node: 'x', path: [1], name: 'y' });
  assert.deepEqual(rules(d), ['servos[0].nodes[3] duplicate', 'servos[0].nodes[4].path empty', 'servos[0].nodes[5].name unknown_field']);
  assert.deepEqual(referencedNodes(d), ['arm', 'button', 'internal-pack', 'screen', 'servo', 'x']);
});

test('nodes to hide while the device runs: name patterns with * wildcards, each once', () => {
  const d = sample();
  d.hide = ['official-screen-frame-*', 'sticker'];
  assert.deepEqual(rules(d), []);
  d.hide = ['', 'a', 'a', 3];
  assert.deepEqual(rules(d), ['hide[0] empty', 'hide[3] type', 'hide duplicate']);
});

test('unknown fields are rejected (typos do not pass silently)', () => {
  const d = sample();
  d.screen.nod = 'x';
  assert.deepEqual(rules(d), ['screen.nod unknown_field']);
});

test('the firmware module and license files must be listed in files', () => {
  const d = sample();
  d.files = d.files.filter((f) => f.path !== 'firmware/test-device.mjs' && f.path !== 'licenses/LICENSE');
  const r = rules(d);
  assert.ok(r.includes('runtime.module not_in_files'), r.join('\n'));
  assert.ok(r.includes('firmware.license.files[0] not_in_files'));
});

test('file paths stay inside the package folders', () => {
  const d = sample();
  d.files.push({ path: '../evil.js', size: 1, sha256: 'd'.repeat(64) }, { path: 'device.json', size: 1, sha256: 'e'.repeat(64) });
  const r = rules(d);
  assert.ok(r.includes('files[3].path bad_path'), r.join('\n'));
  assert.ok(r.includes('files[4].path bad_path'));
});

test('sections and channels must agree', () => {
  const d = sample();
  delete d.screen;
  delete d.hostLink;
  d.channels.in.push('mic');
  const r = rules(d);
  assert.ok(r.includes('screen required'), r.join('\n'));
  assert.ok(r.includes('hostLink required'));
  assert.ok(r.includes('mic required'));
});

test('a button input needs the button channel; a touch input must be on the screen node', () => {
  const d = sample();
  d.channels.in = ['hostRx', 'hostPresent'];
  d.inputs.push({ kind: 'touch', node: 'case' });
  const r = rules(d);
  assert.ok(r.includes('inputs[0] channel_not_declared'), r.join('\n'));
  assert.ok(r.includes('inputs[1] channel_not_declared'));
  assert.ok(r.includes('inputs[1].node not_screen_node'));
});

test('ranges and formats are checked', () => {
  const d = sample();
  d.hostLink.port = 80;
  d.screen.rotateCW = 45;
  d.firmware.upstream.commit = 'abc';
  d.firmware.upstream.repo = 'http://example.com/x';
  d.screen.area.width = 1.5;
  d.servos[0].axis = [0, 0, 0];
  const r = rules(d);
  for (const want of ['hostLink.port range', 'screen.rotateCW enum', 'firmware.upstream.commit format', 'firmware.upstream.repo format', 'screen.area.width range', 'servos[0].axis zero_vector']) {
    assert.ok(r.includes(want), `${want} missing in\n${r.join('\n')}`);
  }
});

test('not an object at all', () => {
  assert.deepEqual(rules(null), [' type']);
  assert.deepEqual(rules('x'), [' type']);
});

test('referencedNodes lists every model node the description points at, once', () => {
  const d = sample();
  d.inputs.push({ kind: 'touch', node: 'screen' });
  d.hide = ['frame-*'];
  assert.deepEqual(referencedNodes(d), ['arm', 'button', 'screen', 'servo']);
});
