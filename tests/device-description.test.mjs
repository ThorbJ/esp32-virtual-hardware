import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateDeviceDescription, referencedNodes, FORMAT_VERSION } from '../device-description/validate.mjs';
import { sample } from './sample-description.mjs';

const rules = (d) => validateDeviceDescription(d).issues.map((i) => `${i.path} ${i.rule}`);

test('a complete description is accepted', () => {
  const r = validateDeviceDescription(sample());
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.equal(FORMAT_VERSION, 1);
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

test('an unknown format version is rejected', () => {
  assert.deepEqual(rules({ ...sample(), formatVersion: 2 }), ['formatVersion unsupported_version']);
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
  assert.deepEqual(referencedNodes(d), ['arm', 'button', 'screen', 'servo']);
});
