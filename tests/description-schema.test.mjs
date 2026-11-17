// schema.json describes the same structure as validate.mjs. Cross-field rules (files listed, channels agreeing with sections)
// are only in validate.mjs; every structural case here must be judged the same by both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateDeviceDescription } from '../device-description/validate.mjs';
import { sample } from './sample-description.mjs';

const schema = JSON.parse(readFileSync(new URL('../device-description/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaAccepts = ajv.compile(schema);

const cases = {
  'complete sample': (d) => d,
  'no screen section, no screen channel': (d) => { delete d.screen; d.channels.out = d.channels.out.filter((c) => c !== 'screen'); return d; },
  'joystick and touch inputs': (d) => { d.channels.in.push('joystick', 'touch'); d.inputs.push({ kind: 'joystick', node: 'stick', right: [1, 0, 0], up: [0, 0, -1], radiusMm: 4, button: 3 }, { kind: 'touch', node: 'screen' }); return d; },
  'pivot as a point': (d) => { d.servos[0].pivot = [1, 2, 3]; return d; },
  'mic section': (d) => { d.channels.in.push('mic'); d.mic = { sampleRate: 16000 }; return d; },
  'screen face, mirrored picture': (d) => { d.screen.face = { path: [0, 17, 0], primitive: 0 }; d.screen.flipY = true; d.screen.flipX = false; return d; },
  'a servo joint on another one': (d) => { d.servos.push({ id: 1, parent: 0, nodes: ['head'], pivot: [0, 87, -2], axis: [1, 0, 0], zeroDeg: 90, direction: 1, scale: 1 }); return d; },
  'hidden nodes': (d) => { d.hide = ['official-screen-frame-*']; return d; },
  'unnamed servo node by path': (d) => { d.servos[0].nodes.push({ node: 'internal-pack', path: [9] }); return d; },
};
const broken = {
  'format version 1': (d) => { d.formatVersion = 1; return d; },
  'format 1 materialIndex': (d) => { d.screen.materialIndex = 0; return d; },
  'unknown face field': (d) => { d.screen.face = { name: 'glass' }; return d; },
  'negative face path step': (d) => { d.screen.face = { path: [-1] }; return d; },
  'flipY not a boolean': (d) => { d.screen.flipY = 1; return d; },
  'parent not an integer': (d) => { d.servos[0].parent = 'x'; return d; },
  'empty hide pattern': (d) => { d.hide = ['']; return d; },
  'hide pattern twice': (d) => { d.hide = ['a', 'a']; return d; },
  'servo node path empty': (d) => { d.servos[0].nodes.push({ node: 'internal-pack', path: [] }); return d; },
  'servo node object without node': (d) => { d.servos[0].nodes.push({ path: [1] }); return d; },
  'unknown top-level field': (d) => { d.extra = 1; return d; },
  'unknown nested field': (d) => { d.screen.nod = 'x'; return d; },
  'short commit': (d) => { d.firmware.upstream.commit = 'abc'; return d; },
  'http repo': (d) => { d.firmware.upstream.repo = 'http://x/y'; return d; },
  'port 80': (d) => { d.hostLink.port = 80; return d; },
  'rotate 45': (d) => { d.screen.rotateCW = 45; return d; },
  'unknown channel': (d) => { d.channels.in.push('wifi'); return d; },
  'unknown input kind': (d) => { d.inputs[0].kind = 'knob'; return d; },
  'path outside package folders': (d) => { d.files[0].path = '../x.mjs'; return d; },
  'path with a . part': (d) => { d.files[0].path = 'firmware/./x.mjs'; return d; },
  'file name with ..': (d) => { d.files[0].path = 'firmware/x..mjs'; d.runtime.module = 'firmware/x..mjs'; return d; },
  'bad sha256': (d) => { d.files[0].sha256 = 'XYZ'; return d; },
  'direction 2': (d) => { d.servos[0].direction = 2; return d; },
  'missing firmware.license': (d) => { delete d.firmware.license; return d; },
  'empty kit': (d) => { d.appliesTo.kit = ''; return d; },
  'button without number': (d) => { delete d.inputs[0].button; return d; },
  'area wider than 1': (d) => { d.screen.area.width = 1.5; return d; },
};

for (const [name, change] of Object.entries(cases)) {
  test(`both accept: ${name}`, () => {
    const d = change(sample());
    assert.deepEqual(validateDeviceDescription(d).issues, []);
    assert.equal(schemaAccepts(d), true, JSON.stringify(schemaAccepts.errors));
  });
}
for (const [name, change] of Object.entries(broken)) {
  test(`both reject: ${name}`, () => {
    const d = change(sample());
    assert.equal(validateDeviceDescription(d).ok, false);
    assert.equal(schemaAccepts(d), false);
  });
}
