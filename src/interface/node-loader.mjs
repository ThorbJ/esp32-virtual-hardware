// Node: load a built firmware module (an emscripten ES module factory) from a file. The browser uses the web runtime instead.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** file: path of the firmware .mjs. Returns a factory for createVirtualDevice; side files (.wasm, .data) are found next to it. */
export async function loadFirmwareFile(file) {
  if (!existsSync(file)) throw new Error(`firmware module not found: ${file} (build it first)`);
  const mod = await import(pathToFileURL(file).href);
  const dir = path.dirname(file);
  return (options = {}) => mod.default({ locateFile: (p) => path.join(dir, p), ...options });
}
