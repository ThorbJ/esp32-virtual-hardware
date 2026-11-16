// File writing helpers for build scripts.
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Write through a temporary file in the same folder and rename, so a file is never half written. Keeps the old mode unless given. */
export function writeFileAtomic(file, data, { mode } = {}) {
  const m = mode ?? (existsSync(file) ? statSync(file).mode & 0o777 : 0o644);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.vhw-${process.pid}.tmp`);
  writeFileSync(tmp, data, { mode: m });
  chmodSync(tmp, m);
  renameSync(tmp, file);
}

/** Write only when the content changed (keeps the modification time the incremental build relies on). */
export function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  writeFileSync(file, content);
}

/** Copy only when the content changed. */
export function copyIfChanged(from, to) {
  const data = readFileSync(from);
  if (existsSync(to) && readFileSync(to).equals(data)) return;
  copyFileSync(from, to);
}
