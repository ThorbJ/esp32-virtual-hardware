// Incremental emscripten build: compiles every source to .o in parallel (out of date by its dependency file), then links.
// Every device build uses it; it knows nothing about a particular firmware.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(cmd, args, { quiet = false, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) { if (out.trim() && !quiet) process.stdout.write(out); resolve(out); } else {
        const err = new Error(`${cmd} exited with ${code}`);
        err.output = out;
        reject(err);
      }
    });
  });
}

function mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }

function upToDate(obj, dep, stampFile, stamp) {
  if (!existsSync(obj) || !existsSync(dep)) return false;
  if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stamp) return false;
  const objTime = mtime(obj);
  const text = readFileSync(dep, 'utf8').replace(/\\\n/g, ' ');
  const files = text.slice(text.indexOf(':') + 1).split(/(?<!\\)\s+/).filter(Boolean).map((f) => f.replace(/\\ /g, ' '));
  return files.every((f) => { const t = mtime(f); return t !== 0 && t <= objTime; });
}

/**
 * units: [{ src, flags: [...], lang: 'c'|'c++' }]
 * Returns the .o paths (same order as units).
 */
export async function compileAll(units, { objDir, force = false, jobs = Math.max(2, os.cpus().length) } = {}) {
  mkdirSync(objDir, { recursive: true });
  const objs = [];
  const queue = [];
  for (const u of units) {
    const id = createHash('sha1').update(u.src).digest('hex').slice(0, 10);
    const base = path.join(objDir, `${path.basename(u.src).replace(/[^\w.-]/g, '_')}.${id}`);
    const obj = `${base}.o`;
    const dep = `${base}.d`;
    const stampFile = `${base}.flags`;
    const compiler = u.lang === 'c' ? 'emcc' : 'em++';
    const args = [...(u.lang === 'c++' && /\.ino$/.test(u.src) ? ['-x', 'c++'] : []), ...u.flags, '-MMD', '-MF', dep, '-c', u.src, '-o', obj];
    const stamp = `${compiler} ${args.join(' ')}`;
    objs.push(obj);
    if (!force && upToDate(obj, dep, stampFile, stamp)) continue;
    queue.push({ compiler, args, src: u.src, stampFile, stamp });
  }
  let failed = [];
  let done = 0;
  const total = queue.length;
  if (total) console.log(`  compiling ${total} sources (${jobs} in parallel)…`);
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        await run(job.compiler, job.args, { quiet: !process.env.VHW_VERBOSE });
        writeFileSync(job.stampFile, job.stamp);
      } catch (e) {
        failed.push({ src: job.src, output: e.output || String(e) });
      }
      done++;
      if (done % 50 === 0) console.log(`  … ${done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  if (failed.length) {
    for (const f of failed.slice(0, 8)) console.error(`\n✖ ${f.src}\n${f.output.split('\n').slice(0, 40).join('\n')}`);
    throw new Error(`${failed.length} sources failed to compile (${failed.slice(0, 20).map((f) => path.basename(f.src)).join(', ')})`);
  }
  return objs;
}

/** Which of these local folders a built module's text names (it must name none: packages are public and run anywhere). */
export function localPathsIn(text, dirs) {
  return dirs.filter((d) => d && d.split(/[\\/]/).filter(Boolean).length >= 2 && text.includes(d)); // never '/' or a drive root
}

/**
 * Link the firmware module `out` (absolute path; its side files .wasm / .data land next to it). The link runs in out's folder
 * with a relative -o: emscripten writes the -o path of the .data file into the module, and an absolute one would name the
 * build machine's folders and break loading elsewhere. Paths in flags (e.g. --preload-file src@dst) must be absolute.
 * Fails when the linked module still names the output folder or the working folder.
 */
export async function link(objs, { out, flags, force = false }) {
  mkdirSync(path.dirname(out), { recursive: true });
  const newest = Math.max(...objs.map(mtime));
  const stampFile = `${out}.linkflags`;
  const stamp = flags.join(' ');
  if (!force && mtime(out) > newest && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
    console.log(`  ✓ ${path.basename(out)} is up to date`);
    return;
  }
  console.log(`  linking ${path.basename(out)} …`);
  const rsp = `${out}.objs.rsp`;
  writeFileSync(rsp, objs.map((o) => `"${o}"`).join('\n'));
  await run('em++', [`@${path.resolve(rsp)}`, ...flags, '-o', path.basename(out)], { cwd: path.dirname(path.resolve(out)) });
  const leaked = localPathsIn(readFileSync(out, 'latin1'), [path.dirname(path.resolve(out)), process.cwd()]);
  if (leaked.length) throw new Error(`${path.basename(out)} names local folders (${leaked.join(', ')}): check the link flags for relative or local paths`);
  writeFileSync(stampFile, stamp);
}
