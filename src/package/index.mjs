// Virtual device package (虚拟设备包): one archive file holding the firmware build and its device description.
//
// Layout (gzip-compressed POSIX tar):
//   device.json               the device description (device-description/README.md); its `files` lists every other file
//   firmware/<name>.mjs       the firmware module (emscripten ES module factory) named by runtime.module
//   firmware/<name>.wasm      …and its other build outputs (.wasm, preloaded .data)
//   licenses/<file>           licence texts the firmware's licence asks to ship with it (optional)
// Nothing else: no keys, no personal data. No dependencies; browsers, Node 22+ and Workers.
import { DESCRIPTION_FILE, sha256Hex, validateDeviceDescription, checkPackageFiles } from '../../device-description/validate.mjs';
import { readTar, writeTar } from './tar.mjs';

export { DESCRIPTION_FILE };
/** File name ending of a package archive. */
export const PACKAGE_EXTENSION = '.vdpkg.tgz';

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
const isGzip = (b) => b.byteLength > 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * Build a package. description: everything except `files` (filled in here from the files given, sorted by path).
 * files: Map<path, Uint8Array> of firmware/… and licenses/… files. Refuses a description that does not validate.
 * Returns { description, archive } (archive: gzip-compressed tar bytes, the same bytes for the same input).
 */
export async function buildPackage({ description, files }) {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  const list = [];
  for (const path of [...map.keys()].sort()) list.push({ path, size: map.get(path).byteLength, sha256: await sha256Hex(map.get(path)) });
  const full = { ...description, files: list };
  const { issues } = validateDeviceDescription(full);
  if (issues.length) throw new Error(`device description is not valid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  const fileIssues = await checkPackageFiles(full, map);
  if (fileIssues.length) throw new Error(fileIssues.map((i) => i.message).join('\n'));
  const tar = writeTar(new Map([[DESCRIPTION_FILE, new TextEncoder().encode(`${JSON.stringify(full, null, 2)}\n`)], ...map]));
  return { description: full, archive: await pipe(tar, new CompressionStream('gzip')) };
}

/**
 * Read a package archive (gzip-compressed or plain tar). Returns { description, files } where files excludes device.json.
 * Only unpacks and parses; validate with validateDeviceDescription and checkPackageFiles.
 */
export async function readPackage(bytes) {
  let entries;
  try {
    entries = readTar(isGzip(bytes) ? await pipe(bytes, new DecompressionStream('gzip')) : bytes);
  } catch (err) {
    throw new Error(`not a package archive (${err.message})`);
  }
  const raw = entries.get(DESCRIPTION_FILE);
  if (!raw) throw new Error(`not a package archive (no ${DESCRIPTION_FILE})`);
  let description;
  try { description = JSON.parse(new TextDecoder().decode(raw)); } catch (err) { throw new Error(`${DESCRIPTION_FILE} is not JSON (${err.message})`); }
  entries.delete(DESCRIPTION_FILE);
  return { description, files: entries };
}
