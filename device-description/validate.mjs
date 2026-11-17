// Device description (设备说明) validator, format version 2.
//
// One file, no dependencies, plain JavaScript: browsers, Node 22+ and Cloudflare Workers can import it as it is, and a project
// may copy it (keep this header and the version). The written definition is README.md next to this file; schema.json is the
// same structure as JSON Schema (2020-12). This validator checks the structure and the rules JSON Schema cannot express
// (files listed, channels and sections agreeing, servo joints mounted on servo joints without loops). checkPackageFiles also checks
// a package's files against the description; checkNodesInModel checks the Kit model nodes and the screen face it points at.
//
//   import { validateDeviceDescription, checkPackageFiles, checkNodesInModel } from 'esp32-virtual-hardware/device-description';
//   const { ok, issues } = validateDeviceDescription(JSON.parse(text));
//   // issues: [{ path: 'screen.panel.width', rule: 'range', message: '…' }], every problem at once, in document order.
//
// Rule codes are stable (a checker may translate them): required, type, unknown_field, enum, format, range, empty, duplicate,
// unsupported_version, bad_path, not_in_files, channel_not_declared, not_screen_node, zero_vector, unknown_servo, servo_cycle,
// file_missing, file_unlisted, size_mismatch, sha256_mismatch, package_too_large, unknown_node, bad_screen_face.

export const FORMAT_VERSION = 2;
/** The virtual device interface version this format describes (vhw/include/vdev_io.h VDEV_IO_VERSION). */
export const INTERFACE_VERSION = 3;
/** Upper limit of one package: all files together, bytes. */
export const PACKAGE_MAX_BYTES = 32 * 1024 * 1024;
/** Name of the description inside a package archive. */
export const DESCRIPTION_FILE = 'device.json';

export const INPUT_CHANNELS = Object.freeze(['button', 'joystick', 'touch', 'mic', 'camera', 'hostRx', 'hostPresent']);
export const OUTPUT_CHANNELS = Object.freeze(['screen', 'servo', 'speaker', 'hostTx', 'log']);
export const INPUT_KINDS = Object.freeze(['button', 'joystick', 'touch']);

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HTTPS = /^https:\/\/[^\s/]+\/\S*$/;
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FILE_PATH = /^(firmware|licenses)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * The one rule for a file path in a package (files[].path), for every program that checks, stores or serves package files: under
 * firmware/ or licenses/, parts of letters, digits, `.`, `_` and `-` joined by single `/` (so no empty part, leading `/`, backslash,
 * space or control character), no part that is `.`, and no `..` anywhere (not even inside a name: web servers refuse such paths).
 */
export function isPackageFilePath(path) {
  return typeof path === 'string' && FILE_PATH.test(path) && !path.includes('..') && !path.split('/').includes('.');
}

/**
 * Validate a parsed device description. Returns { ok, issues }.
 * Paths use dots and [index]; '' is the whole document.
 */
export function validateDeviceDescription(d) {
  const issues = [];
  const add = (path, rule, message) => issues.push({ path, rule, message });
  const v = validator(add);

  if (!v.object('', d)) return { ok: false, issues };
  v.fields('', d, ['formatVersion', 'device', 'appliesTo', 'firmware', 'runtime', 'files', 'channels', 'screen', 'inputs', 'servos', 'hostLink', 'mic', 'hide'],
    ['formatVersion', 'device', 'appliesTo', 'firmware', 'runtime', 'files', 'channels']);

  if ('formatVersion' in d && d.formatVersion !== FORMAT_VERSION) {
    add('formatVersion', 'unsupported_version', `formatVersion must be ${FORMAT_VERSION}`);
  }

  if (v.object('device', d.device, true)) {
    v.fields('device', d.device, ['id'], ['id']);
    v.string('device.id', d.device.id, ID, 'lower-case letters, digits, - and _');
  }

  if (v.object('appliesTo', d.appliesTo, true)) {
    v.fields('appliesTo', d.appliesTo, ['kit', 'options'], ['kit', 'options']);
    v.string('appliesTo.kit', d.appliesTo.kit);
    if (v.array('appliesTo.options', d.appliesTo.options, true)) {
      d.appliesTo.options.forEach((o, i) => v.string(`appliesTo.options[${i}]`, o));
      v.unique('appliesTo.options', d.appliesTo.options);
    }
  }

  if (v.object('firmware', d.firmware, true)) {
    const f = d.firmware;
    v.fields('firmware', f, ['version', 'upstream', 'virtualDevice', 'license'], ['version', 'upstream', 'virtualDevice', 'license']);
    v.string('firmware.version', f.version);
    for (const k of ['upstream', 'virtualDevice']) {
      if (!v.object(`firmware.${k}`, f[k], true)) continue;
      v.fields(`firmware.${k}`, f[k], ['repo', 'commit'], ['repo', 'commit']);
      v.string(`firmware.${k}.repo`, f[k].repo, HTTPS, 'an https:// URL');
      v.string(`firmware.${k}.commit`, f[k].commit, SHA1, 'a full 40-character git commit');
    }
    if (v.object('firmware.license', f.license, true)) {
      const l = f.license;
      v.fields('firmware.license', l, ['spdx', 'note', 'unofficial', 'files'], ['spdx', 'unofficial']);
      v.string('firmware.license.spdx', l.spdx);
      v.boolean('firmware.license.unofficial', l.unofficial);
      if ('note' in l) v.bilingual('firmware.license.note', l.note);
      if ('files' in l && v.array('firmware.license.files', l.files)) l.files.forEach((p, i) => v.string(`firmware.license.files[${i}]`, p));
    }
  }

  if (v.object('runtime', d.runtime, true)) {
    const r = d.runtime;
    v.fields('runtime', r, ['interfaceVersion', 'module', 'memoryMB', 'threads', 'virtualTime'], ['interfaceVersion', 'module', 'memoryMB', 'threads', 'virtualTime']);
    if ('interfaceVersion' in r && r.interfaceVersion !== INTERFACE_VERSION) add('runtime.interfaceVersion', 'unsupported_version', `runtime.interfaceVersion must be ${INTERFACE_VERSION}`);
    if (v.string('runtime.module', r.module) && !/\.mjs$/.test(r.module)) add('runtime.module', 'format', 'runtime.module must be an .mjs file');
    v.integer('runtime.memoryMB', r.memoryMB, 16, 4096);
    v.integer('runtime.threads', r.threads, 1, 64);
    v.boolean('runtime.virtualTime', r.virtualTime);
  }

  const listed = new Set();
  if (v.array('files', d.files, true)) {
    if (d.files.length === 0) add('files', 'empty', 'files must list at least the firmware module');
    d.files.forEach((f, i) => {
      const p = `files[${i}]`;
      if (!v.object(p, f)) return;
      v.fields(p, f, ['path', 'size', 'sha256'], ['path', 'size', 'sha256']);
      if (v.string(`${p}.path`, f.path)) {
        if (!isPackageFilePath(f.path)) add(`${p}.path`, 'bad_path', 'a file path must be under firmware/ or licenses/, without . parts or .. anywhere');
        else if (listed.has(f.path)) add(`${p}.path`, 'duplicate', `${f.path} is listed twice`);
        listed.add(f.path);
      }
      v.integer(`${p}.size`, f.size, 0, PACKAGE_MAX_BYTES);
      v.string(`${p}.sha256`, f.sha256, SHA256, '64 lower-case hex characters');
    });
    if (typeof d.runtime?.module === 'string' && !listed.has(d.runtime.module)) add('runtime.module', 'not_in_files', `${d.runtime.module} is not in files`);
    (Array.isArray(d.firmware?.license?.files) ? d.firmware.license.files : []).forEach((p, i) => {
      if (typeof p === 'string' && !listed.has(p)) add(`firmware.license.files[${i}]`, 'not_in_files', `${p} is not in files`);
    });
  }

  const chIn = new Set();
  const chOut = new Set();
  if (v.object('channels', d.channels, true)) {
    v.fields('channels', d.channels, ['in', 'out'], ['in', 'out']);
    for (const [k, allowed, set] of [['in', INPUT_CHANNELS, chIn], ['out', OUTPUT_CHANNELS, chOut]]) {
      if (!v.array(`channels.${k}`, d.channels[k], true)) continue;
      d.channels[k].forEach((c, i) => { if (v.enum(`channels.${k}[${i}]`, c, allowed)) set.add(c); });
      v.unique(`channels.${k}`, d.channels[k]);
    }
  }

  // Sections required by the channels, and channels required by the sections.
  const needs = (present, path, why) => { if (!present) add(path, 'required', `${path} is required ${why}`); };
  needs('screen' in d || !chOut.has('screen'), 'screen', 'when the screen channel is used');
  needs('hostLink' in d || !(chIn.has('hostRx') || chOut.has('hostTx')), 'hostLink', 'when the computer byte stream is used');
  needs('mic' in d || !chIn.has('mic'), 'mic', 'when the mic channel is used');
  needs('servos' in d || !chOut.has('servo'), 'servos', 'when the servo channel is used');
  if ('screen' in d && !chOut.has('screen')) add('screen', 'channel_not_declared', 'a screen section needs the screen output channel');
  if ('hostLink' in d && !(chIn.has('hostRx') && chOut.has('hostTx'))) add('hostLink', 'channel_not_declared', 'a hostLink needs the hostRx input and hostTx output channels');
  if ('servos' in d && Array.isArray(d.servos) && d.servos.length && !chOut.has('servo')) add('servos', 'channel_not_declared', 'servos need the servo output channel');

  if ('screen' in d && v.object('screen', d.screen)) {
    const s = d.screen;
    v.fields('screen', s, ['node', 'face', 'panel', 'rotateCW', 'flipX', 'flipY', 'area', 'background'], ['node', 'panel', 'rotateCW', 'area']);
    v.string('screen.node', s.node);
    if ('face' in s && v.object('screen.face', s.face)) {
      v.fields('screen.face', s.face, ['path', 'primitive'], []);
      if ('path' in s.face && v.array('screen.face.path', s.face.path)) s.face.path.forEach((n, i) => v.integer(`screen.face.path[${i}]`, n, 0, 65535));
      if ('primitive' in s.face) v.integer('screen.face.primitive', s.face.primitive, 0, 255);
    }
    if ('flipX' in s) v.boolean('screen.flipX', s.flipX);
    if ('flipY' in s) v.boolean('screen.flipY', s.flipY);
    if (v.object('screen.panel', s.panel, true)) {
      v.fields('screen.panel', s.panel, ['width', 'height', 'format'], ['width', 'height', 'format']);
      v.integer('screen.panel.width', s.panel.width, 1, 2048);
      v.integer('screen.panel.height', s.panel.height, 1, 2048);
      v.enum('screen.panel.format', s.panel.format, ['rgb565']);
    }
    v.enum('screen.rotateCW', s.rotateCW, [0, 90, 180, 270]);
    if (v.object('screen.area', s.area, true)) {
      const a = s.area;
      v.fields('screen.area', a, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
      v.number('screen.area.x', a.x, 0, 1);
      v.number('screen.area.y', a.y, 0, 1);
      if (v.number('screen.area.width', a.width, 0, 1) && a.width === 0) add('screen.area.width', 'range', 'screen.area.width must be above 0');
      if (v.number('screen.area.height', a.height, 0, 1) && a.height === 0) add('screen.area.height', 'range', 'screen.area.height must be above 0');
      if ([a.x, a.y, a.width, a.height].every((n) => typeof n === 'number') && (a.x + a.width > 1.000001 || a.y + a.height > 1.000001)) add('screen.area', 'range', 'screen.area must lie inside 0..1');
    }
    if ('background' in s) v.string('screen.background', s.background, COLOR, '#rrggbb');
  }

  if ('inputs' in d && v.array('inputs', d.inputs)) {
    d.inputs.forEach((inp, i) => {
      const p = `inputs[${i}]`;
      if (!v.object(p, inp)) return;
      if (!v.enum(`${p}.kind`, inp.kind, INPUT_KINDS)) return;
      if (!chIn.has(inp.kind)) add(p, 'channel_not_declared', `a ${inp.kind} input needs the ${inp.kind} input channel`);
      if (inp.kind === 'button') {
        v.fields(p, inp, ['kind', 'node', 'button', 'press'], ['kind', 'node', 'button']);
        v.integer(`${p}.button`, inp.button, 0, 31);
      } else if (inp.kind === 'joystick') {
        v.fields(p, inp, ['kind', 'node', 'right', 'up', 'radiusMm', 'button', 'press'], ['kind', 'node', 'right', 'up', 'radiusMm']);
        v.vector(`${p}.right`, inp.right, true);
        v.vector(`${p}.up`, inp.up, true);
        if (v.number(`${p}.radiusMm`, inp.radiusMm, 0, 1000) && inp.radiusMm === 0) add(`${p}.radiusMm`, 'range', 'radiusMm must be above 0');
        if ('button' in inp) {
          v.integer(`${p}.button`, inp.button, 0, 31);
          if (!chIn.has('button')) add(`${p}.button`, 'channel_not_declared', 'a joystick press needs the button input channel');
        }
      } else {
        v.fields(p, inp, ['kind', 'node'], ['kind', 'node']);
        if (typeof inp.node === 'string' && inp.node !== d.screen?.node) add(`${p}.node`, 'not_screen_node', 'a touch input must be on the screen node');
      }
      v.string(`${p}.node`, inp.node);
      if ('press' in inp && v.object(`${p}.press`, inp.press)) {
        v.fields(`${p}.press`, inp.press, ['offsetMm'], ['offsetMm']);
        v.vector(`${p}.press.offsetMm`, inp.press.offsetMm);
      }
    });
  }

  if ('servos' in d && v.array('servos', d.servos)) {
    const ids = [];
    const turned = new Set();
    d.servos.forEach((s, i) => {
      const p = `servos[${i}]`;
      if (!v.object(p, s)) return;
      v.fields(p, s, ['id', 'parent', 'nodes', 'pivot', 'axis', 'zeroDeg', 'direction', 'scale', 'minDeg', 'maxDeg', 'approximate'], ['id', 'nodes', 'pivot', 'axis', 'zeroDeg', 'direction', 'scale']);
      if (v.integer(`${p}.id`, s.id, 0, 31)) ids.push(s.id);
      if ('parent' in s) v.integer(`${p}.parent`, s.parent, 0, 31);
      if (v.array(`${p}.nodes`, s.nodes, true)) {
        if (s.nodes.length === 0) add(`${p}.nodes`, 'empty', 'a servo turns at least one node');
        s.nodes.forEach((n, j) => {
          const q = `${p}.nodes[${j}]`;
          if (n !== null && typeof n === 'object' && !Array.isArray(n)) { // { node, path }: an unnamed node under a named one
            v.fields(q, n, ['node', 'path'], ['node', 'path']);
            const named = v.string(`${q}.node`, n.node);
            let pathOk = v.array(`${q}.path`, n.path);
            if (pathOk && n.path.length === 0) { add(`${q}.path`, 'empty', `${q}.path must have at least one step (a name alone is written as a string)`); pathOk = false; }
            if (pathOk) pathOk = n.path.map((k, i) => v.integer(`${q}.path[${i}]`, k, 0, 65535)).every(Boolean);
            if (!named || !pathOk) return;
          } else if (!v.string(q, n)) return;
          const key = nodeRefKey(n);
          if (turned.has(key)) add(q, 'duplicate', `${key} is already turned by another servo (a joint on a parent joint moves with it anyway)`);
          turned.add(key);
        });
      }
      if (Array.isArray(s.pivot)) v.vector(`${p}.pivot`, s.pivot);
      else if (v.object(`${p}.pivot`, s.pivot, true)) {
        v.fields(`${p}.pivot`, s.pivot, ['node'], ['node']);
        v.string(`${p}.pivot.node`, s.pivot.node);
      }
      v.vector(`${p}.axis`, s.axis, true);
      v.number(`${p}.zeroDeg`, s.zeroDeg, -360, 360);
      v.enum(`${p}.direction`, s.direction, [1, -1]);
      v.number(`${p}.scale`, s.scale, 0, 100);
      if ('minDeg' in s) v.number(`${p}.minDeg`, s.minDeg, -360, 360);
      if ('maxDeg' in s) v.number(`${p}.maxDeg`, s.maxDeg, -360, 360);
      if ('approximate' in s) v.bilingual(`${p}.approximate`, s.approximate);
    });
    v.unique('servos.id', ids);
    // parent: the id of another servo this joint is mounted on; following parents must never come back.
    const parentOf = new Map(d.servos.filter((s) => Number.isInteger(s?.id) && Number.isInteger(s?.parent)).map((s) => [s.id, s.parent]));
    d.servos.forEach((s, i) => {
      if (!Number.isInteger(s?.parent) || !Number.isInteger(s?.id)) return;
      if (!ids.includes(s.parent)) { add(`servos[${i}].parent`, 'unknown_servo', `there is no servo ${s.parent} to mount servo ${s.id} on`); return; }
      const seen = new Set([s.id]);
      for (let at = s.parent; at !== undefined; at = parentOf.get(at)) {
        if (seen.has(at)) { add(`servos[${i}].parent`, 'servo_cycle', `servo ${s.id} is mounted on itself through its parents`); return; }
        seen.add(at);
      }
    });
  }

  if ('hide' in d && v.array('hide', d.hide)) {
    d.hide.forEach((h, i) => v.string(`hide[${i}]`, h));
    v.unique('hide', d.hide);
  }

  if ('hostLink' in d && v.object('hostLink', d.hostLink)) {
    const h = d.hostLink;
    v.fields('hostLink', h, ['port', 'path', 'protocol'], ['port', 'path', 'protocol']);
    v.integer('hostLink.port', h.port, 1024, 65535);
    v.string('hostLink.path', h.path, /^\/[\x21-\x7e]*$/, 'a path starting with /');
    v.string('hostLink.protocol', h.protocol);
  }

  if ('mic' in d && v.object('mic', d.mic)) {
    v.fields('mic', d.mic, ['sampleRate'], ['sampleRate']);
    v.enum('mic.sampleRate', d.mic.sampleRate, [8000, 16000, 24000, 32000, 44100, 48000]);
    if (!chIn.has('mic')) add('mic', 'channel_not_declared', 'a mic section needs the mic input channel');
  }

  return { ok: issues.length === 0, issues };
}

/** A servo node reference as one string: the name, or `name/i/j` for { node, path }. */
export function nodeRefKey(ref) {
  return typeof ref === 'string' ? ref : `${ref.node}/${ref.path.join('/')}`;
}

/**
 * Every Kit model node the description refers to by name (screen, inputs, servos, the named starts of servo node paths and
 * servo pivots), sorted, each once. hide patterns are not names.
 */
export function referencedNodes(d) {
  const out = new Set();
  if (typeof d?.screen?.node === 'string') out.add(d.screen.node);
  for (const i of Array.isArray(d?.inputs) ? d.inputs : []) if (typeof i?.node === 'string') out.add(i.node);
  for (const s of Array.isArray(d?.servos) ? d.servos : []) {
    for (const n of Array.isArray(s?.nodes) ? s.nodes : []) {
      if (typeof n === 'string') out.add(n);
      else if (typeof n?.node === 'string') out.add(n.node);
    }
    if (typeof s?.pivot?.node === 'string') out.add(s.pivot.node);
  }
  return [...out].sort();
}

/** Whether a hide pattern matches a node name: the whole name, `*` = any run of characters (also none); nothing else is special. */
export function nodeNameMatches(pattern, name) {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
  return re.test(name);
}

/**
 * Check the description against the Kit model it is used with: every node it names exists, every hide pattern matches at least
 * one node, and the screen face (screen.node, then screen.face.path through glTF children, then screen.face.primitive) is a
 * mesh primitive with texture coordinates. model: the GLB bytes (Uint8Array or ArrayBuffer) or its parsed glTF JSON.
 * A node name means the first node of that name in the default scene, depth first (what three.js getObjectByName finds).
 * Returns issues (rules unknown_node, bad_screen_face).
 */
export function checkNodesInModel(d, model) {
  if (Array.isArray(model)) throw new TypeError('checkNodesInModel needs the Kit model (GLB bytes or glTF JSON), not a list of names: format 2 also checks the screen face');
  const gltf = model instanceof Uint8Array || model instanceof ArrayBuffer ? glbJson(model instanceof ArrayBuffer ? new Uint8Array(model) : model) : model;
  const nodes = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
  const order = sceneNodes(gltf);
  const byName = new Map();
  for (const i of order) { const n = nodes[i]?.name; if (typeof n === 'string' && !byName.has(n)) byName.set(n, i); }
  const issues = [];
  const add = (path, rule, message) => issues.push({ path, rule, message });
  const need = (path, n) => { if (typeof n === 'string' && !byName.has(n)) add(path, 'unknown_node', `the Kit model has no node ${n}`); };
  need('screen.node', d?.screen?.node);
  (Array.isArray(d?.inputs) ? d.inputs : []).forEach((inp, i) => need(`inputs[${i}].node`, inp?.node));
  const walk = (from, path) => { let at = from; for (const step of path) { at = nodes[at]?.children?.[step]; if (at === undefined) return undefined; } return at; };
  (Array.isArray(d?.servos) ? d.servos : []).forEach((s, i) => {
    (Array.isArray(s?.nodes) ? s.nodes : []).forEach((n, j) => {
      if (typeof n === 'string' || typeof n?.node !== 'string' || !Array.isArray(n.path)) { need(`servos[${i}].nodes[${j}]`, n); return; }
      if (!byName.has(n.node)) add(`servos[${i}].nodes[${j}]`, 'unknown_node', `the Kit model has no node ${n.node}`);
      else if (walk(byName.get(n.node), n.path) === undefined) add(`servos[${i}].nodes[${j}]`, 'unknown_node', `${n.node} has no node at path ${JSON.stringify(n.path)}`);
    });
    need(`servos[${i}].pivot.node`, s?.pivot?.node);
  });
  (Array.isArray(d?.hide) ? d.hide : []).forEach((h, i) => {
    if (typeof h === 'string' && ![...byName.keys()].some((n) => nodeNameMatches(h, n))) add(`hide[${i}]`, 'unknown_node', `no node of the Kit model matches ${h}`);
  });
  if (typeof d?.screen?.node === 'string' && byName.has(d.screen.node)) {
    const face = d.screen.face ?? {};
    const path = Array.isArray(face.path) ? face.path : [];
    const at = walk(byName.get(d.screen.node), path);
    if (at === undefined) { add('screen.face.path', 'bad_screen_face', `${d.screen.node} has no child at screen.face.path ${JSON.stringify(path)}`); return issues; }
    const where = path.length ? `the node at screen.face.path ${JSON.stringify(path)} under ${d.screen.node}` : d.screen.node;
    const mesh = gltf.meshes?.[nodes[at]?.mesh];
    const k = face.primitive ?? 0;
    if (!mesh) add('screen.face', 'bad_screen_face', `${where} has no mesh`);
    else if (!mesh.primitives?.[k]) add('screen.face.primitive', 'bad_screen_face', `the mesh of ${where} has no primitive ${k}`);
    else if (mesh.primitives[k].attributes?.TEXCOORD_0 === undefined) add('screen.face', 'bad_screen_face', `primitive ${k} of ${where} has no texture coordinates (TEXCOORD_0)`);
  }
  return issues;
}

/** Node indexes of the default scene, depth first in children order. */
function sceneNodes(gltf) {
  const out = [];
  const visit = (i) => { if (out.length > 1e6) return; out.push(i); for (const c of gltf.nodes?.[i]?.children ?? []) visit(c); };
  for (const r of gltf?.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(r);
  return out;
}

/** The JSON chunk of a GLB (glTF 2.0 binary), parsed. Throws when the bytes are not a GLB. */
export function glbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('not a GLB (glTF 2.0 binary)');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

/** Node names of a GLB (glTF 2.0 binary), in node order. Throws when the bytes are not a GLB. */
export function glbNodeNames(bytes) {
  return (glbJson(bytes).nodes ?? []).map((n) => n.name).filter((n) => typeof n === 'string');
}

/**
 * Check a package's files against its (valid) description: every listed file present with the listed size and sha256,
 * nothing else in the package besides device.json, and the whole package within PACKAGE_MAX_BYTES.
 * files: Map<path, Uint8Array> (or an object of the same). Uses Web Crypto (browsers, Node 22+, Workers). Resolves to issues.
 */
export async function checkPackageFiles(d, files) {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  const issues = [];
  const add = (path, rule, message) => issues.push({ path, rule, message });
  let total = 0;
  for (const bytes of map.values()) total += bytes.byteLength;
  if (total > PACKAGE_MAX_BYTES) add('', 'package_too_large', `the package is ${total} bytes, over the ${PACKAGE_MAX_BYTES} byte limit`);
  const listed = new Set();
  for (const [i, f] of (Array.isArray(d?.files) ? d.files : []).entries()) {
    listed.add(f.path);
    const bytes = map.get(f.path);
    if (!bytes) { add(`files[${i}]`, 'file_missing', `${f.path} is listed but not in the package`); continue; }
    if (bytes.byteLength !== f.size) add(`files[${i}].size`, 'size_mismatch', `${f.path} is ${bytes.byteLength} bytes, the description says ${f.size}`);
    else if ((await sha256Hex(bytes)) !== f.sha256) add(`files[${i}].sha256`, 'sha256_mismatch', `${f.path} does not match its sha256`);
  }
  for (const p of map.keys()) {
    if (p !== DESCRIPTION_FILE && !listed.has(p)) add('files', 'file_unlisted', `${p} is in the package but not listed in files`);
  }
  return issues;
}

/** sha256 of bytes as lower-case hex (Web Crypto). */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- small structural checks ----------

function validator(add) {
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const v = {
    object(path, x, required = false) {
      if (x === undefined) { if (required) add(path, 'required', `${path} is required`); return false; }
      if (!isObj(x)) { add(path, 'type', `${path || 'the description'} must be an object`); return false; }
      return true;
    },
    array(path, x, required = false) {
      if (x === undefined) { if (required) add(path, 'required', `${path} is required`); return false; }
      if (!Array.isArray(x)) { add(path, 'type', `${path} must be an array`); return false; }
      return true;
    },
    fields(path, obj, allowed, required) {
      const at = (k) => (path ? `${path}.${k}` : k);
      for (const k of required) if (obj[k] === undefined) add(at(k), 'required', `${at(k)} is required`);
      for (const k of Object.keys(obj)) if (!allowed.includes(k)) add(at(k), 'unknown_field', `${at(k)} is not part of format version ${FORMAT_VERSION}`);
    },
    string(path, x, pattern, what) {
      if (x === undefined) return false; // reported by fields()
      if (typeof x !== 'string') { add(path, 'type', `${path} must be a string`); return false; }
      if (x.length === 0) { add(path, 'empty', `${path} must not be empty`); return false; }
      if (pattern && !pattern.test(x)) { add(path, 'format', `${path} must be ${what}`); return false; }
      return true;
    },
    boolean(path, x) {
      if (x === undefined) return false;
      if (typeof x !== 'boolean') { add(path, 'type', `${path} must be true or false`); return false; }
      return true;
    },
    number(path, x, min, max) {
      if (x === undefined) return false;
      if (typeof x !== 'number' || !Number.isFinite(x)) { add(path, 'type', `${path} must be a number`); return false; }
      if (x < min || x > max) { add(path, 'range', `${path} must be within ${min}..${max}`); return false; }
      return true;
    },
    integer(path, x, min, max) {
      if (x === undefined) return false;
      if (!Number.isInteger(x)) { add(path, 'type', `${path} must be an integer`); return false; }
      if (x < min || x > max) { add(path, 'range', `${path} must be within ${min}..${max}`); return false; }
      return true;
    },
    enum(path, x, values) {
      if (x === undefined) return false;
      if (!values.includes(x)) { add(path, 'enum', `${path} must be one of ${values.join(', ')}`); return false; }
      return true;
    },
    vector(path, x, nonZero = false) {
      if (x === undefined) return false;
      if (!Array.isArray(x) || x.length !== 3 || !x.every((n) => typeof n === 'number' && Number.isFinite(n))) { add(path, 'type', `${path} must be [x, y, z]`); return false; }
      if (nonZero && x.every((n) => n === 0)) { add(path, 'zero_vector', `${path} must not be [0, 0, 0]`); return false; }
      return true;
    },
    bilingual(path, x) {
      if (!v.object(path, x, true)) return false;
      v.fields(path, x, ['zh', 'en'], ['zh', 'en']);
      v.string(`${path}.zh`, x.zh);
      v.string(`${path}.en`, x.en);
      return true;
    },
    unique(path, list) {
      const seen = new Set();
      for (const x of list) {
        if (seen.has(x)) { add(path, 'duplicate', `${path} has ${JSON.stringify(x)} twice`); return; }
        seen.add(x);
      }
    },
  };
  return v;
}
