// Minimal POSIX tar (ustar), regular files only. No dependencies; browsers, Node and Workers.
// Written archives are deterministic: entries sorted by path, mtime 0, mode 0644, owner 0.

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder();

function octal(n, width) { return n.toString(8).padStart(width - 1, '0') + '\0'; }

function header(path, size) {
  const h = new Uint8Array(BLOCK);
  const put = (s, off, len) => h.set(enc.encode(s).subarray(0, len), off);
  let name = path;
  let prefix = '';
  if (enc.encode(path).length > 100) {
    const cut = path.lastIndexOf('/', 155);
    if (cut <= 0 || enc.encode(path.slice(cut + 1)).length > 100) throw new Error(`path too long for tar: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  h.fill(0x20, 148, 156); // checksum field counts as spaces
  h[156] = 0x30; // '0' regular file
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(octal(sum, 7) + ' ', 148, 8);
  return h;
}

/** entries: Map<path, Uint8Array> or [[path, bytes]]. */
export function writeTar(entries) {
  const list = [...(entries instanceof Map ? entries : new Map(entries))].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let total = BLOCK * 2;
  for (const [, bytes] of list) total += BLOCK + Math.ceil(bytes.byteLength / BLOCK) * BLOCK;
  const out = new Uint8Array(total);
  let off = 0;
  for (const [path, bytes] of list) {
    out.set(header(path, bytes.byteLength), off);
    off += BLOCK;
    out.set(bytes, off);
    off += Math.ceil(bytes.byteLength / BLOCK) * BLOCK;
  }
  return out;
}

/**
 * A numeric header field: octal digits only (leading spaces allowed, ended by NUL or space), at most `width - 1` digits, so always a
 * non-negative safe integer. Anything else (sign, exponent, hex, base-256, empty) is null.
 */
function octalField(h, off, width) {
  let s = '';
  for (const b of h.subarray(off, off + width)) { if (b === 0) break; s += String.fromCharCode(b); }
  const m = /^ *([0-7]+) *$/.exec(s);
  return m && m[1].length < width ? parseInt(m[1], 8) : null;
}

/** Map<path, Uint8Array> of the regular files. Throws on a malformed archive (bad checksum or size field, truncated entry). */
export function readTar(bytes) {
  const files = new Map();
  let off = 0;
  // Every entry moves at least one block forward, so there are never more entries than blocks.
  for (let n = 0, max = Math.floor(bytes.byteLength / BLOCK); n <= max && off + BLOCK <= bytes.byteLength; n++) {
    const h = bytes.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const str = (o, l) => { const s = h.subarray(o, o + l); const z = s.indexOf(0); return dec.decode(z < 0 ? s : s.subarray(0, z)); };
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (octalField(h, 148, 8) !== sum) throw new Error('bad tar header checksum');
    const size = octalField(h, 124, 12);
    if (size === null) throw new Error('bad tar header size');
    const type = String.fromCharCode(h[156] || 0x30);
    const prefix = str(257, 6).startsWith('ustar') ? str(345, 155) : '';
    const path = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const start = off + BLOCK;
    if (start + size > bytes.byteLength) throw new Error('truncated tar entry');
    if (type === '0' || type === '\0') files.set(path, bytes.slice(start, start + size));
    const next = start + Math.ceil(size / BLOCK) * BLOCK;
    if (next <= off) throw new Error('tar entry does not move forward');
    off = next;
  }
  return files;
}
