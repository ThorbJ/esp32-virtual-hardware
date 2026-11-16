// The test device's Kit model, made in code: a small box device with a screen, a button and a servo arm on top.
// One box per node (positions, normals, texture coordinates), so three.js loads real geometry; the screen box's material
// is unlit, and every face is mapped 0..1 in glTF texture space (origin top-left), so the whole screen image shows on its front.
// Nodes are named like BOM line slugs. Units: mm. No dependencies.

/** The boxes: name (node), material, colour, centre and size in mm. */
export const PARTS = Object.freeze([
  { name: 'case', material: 'appearance:case', color: '#f4f3f0', center: [0, 30, 0], size: [70, 60, 30] },
  { name: 'screen', material: 'screen', color: '#000000', center: [0, 36, 15.5], size: [50, 40, 1], unlit: true },
  { name: 'button', material: 'button', color: '#c43c2c', center: [0, 8, 16], size: [10, 6, 4] },
  { name: 'servo', material: 'servo', color: '#2b4f8f', center: [20, 64, 0], size: [12, 8, 23] },
  { name: 'arm', material: 'arm', color: '#f4f3f0', center: [20, 69, 9], size: [5, 2, 24] },
]);

/** Where the servo arm turns: the servo's output shaft, at the arm's near end (mm, model coordinates). */
export const ARM_PIVOT = Object.freeze([20, 69, 0]);

/** The Kit model manifest (the shop's KitModelManifest, version 1). */
export const MANIFEST = Object.freeze({
  version: 1,
  units: 'mm',
  home: { direction: [0.35, 0.3, 0.88] },
  dimensionsMm: [70, 70, 34],
  lines: [
    { line: 'case', nodes: ['case'], explode: [0, 0, -30] },
    { line: 'screen', nodes: ['screen'], explode: [0, 0, 30] },
    { line: 'button', nodes: ['button'], explode: [0, -20, 20] },
    { line: 'servo', nodes: ['servo', 'arm'], explode: [0, 30, 0] },
  ],
  approximate: [],
});

const FACES = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
// Corners go bottom-left, bottom-right, top-right, top-left as seen from outside: glTF UV origin is the image's top-left.
const UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

const linear = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).concat(1);
const pad4 = (n) => (n + 3) & ~3;

/** The GLB bytes (deterministic). */
export function kitGlb(parts = PARTS) {
  const vb = 24 * 3 * 4;
  const ub = 24 * 2 * 4;
  const ib = 36 * 2;
  const per = vb * 2 + ub + ib;
  const bin = new ArrayBuffer(per * parts.length);
  const json = {
    asset: { version: '2.0', generator: 'esp32-virtual-hardware test-device' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: parts.map((_, i) => i) }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [{ byteLength: bin.byteLength }],
  };
  const materials = new Map();
  parts.forEach((p, i) => {
    const base = per * i;
    const pos = new Float32Array(bin, base, 72);
    const nor = new Float32Array(bin, base + vb, 72);
    const uv = new Float32Array(bin, base + vb * 2, 48);
    const idx = new Uint16Array(bin, base + vb * 2 + ub, 36);
    const half = p.size.map((s) => s / 2);
    FACES.forEach((f, fi) => {
      f.c.forEach((corner, ci) => {
        const v = fi * 4 + ci;
        for (let k = 0; k < 3; k++) { pos[v * 3 + k] = corner[k] * half[k]; nor[v * 3 + k] = f.n[k]; }
        uv[v * 2] = UV[ci][0];
        uv[v * 2 + 1] = UV[ci][1];
      });
      idx.set([0, 1, 2, 0, 2, 3].map((n) => fi * 4 + n), fi * 6);
    });
    let m = materials.get(p.material);
    if (m === undefined) {
      const mat = { name: p.material, pbrMetallicRoughness: { baseColorFactor: linear(p.color), metallicFactor: 0, roughnessFactor: 0.5 } };
      if (p.unlit) mat.extensions = { KHR_materials_unlit: {} };
      m = json.materials.push(mat) - 1;
      materials.set(p.material, m);
    }
    const view = (off, len, target) => json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: len, target }) - 1;
    const POSITION = json.accessors.push({ bufferView: view(base, vb, 34962), componentType: 5126, count: 24, type: 'VEC3', min: half.map((h) => -h), max: half }) - 1;
    const NORMAL = json.accessors.push({ bufferView: view(base + vb, vb, 34962), componentType: 5126, count: 24, type: 'VEC3' }) - 1;
    const TEXCOORD_0 = json.accessors.push({ bufferView: view(base + vb * 2, ub, 34962), componentType: 5126, count: 24, type: 'VEC2' }) - 1;
    const indices = json.accessors.push({ bufferView: view(base + vb * 2 + ub, ib, 34963), componentType: 5123, count: 36, type: 'SCALAR' }) - 1;
    const mesh = json.meshes.push({ name: p.name, primitives: [{ attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices, material: m }] }) - 1;
    json.nodes.push({ name: p.name, mesh, translation: p.center });
  });
  const jb = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad4(jb.length);
  const bl = pad4(bin.byteLength);
  const out = new Uint8Array(28 + jl + bl);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20);
  out.fill(0x20, 20 + jb.length, 20 + jl);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  out.set(new Uint8Array(bin), 28 + jl);
  return out;
}
