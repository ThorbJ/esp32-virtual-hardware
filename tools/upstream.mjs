// Upstream sources pinned by commit. A device repository keeps an `upstream.lock.json`:
//
//   { "sources": { "<name>": { "url": "https://github.com/…", "commit": "<40 hex>", "sparse": ["dir", …]?, "usedBy": ["<device>"] } } }
//
// Sources are fetched shallowly at that exact commit into a git-ignored folder and never modified here.
//
//   const up = openUpstream({ root, lockFile: 'upstream.lock.json', cacheEnv: 'BRUFIK_UPSTREAM_CACHE' });
//   up.ensure('OpenDeskBotV2'); up.path('OpenDeskBotV2'); up.check('OpenDeskBotV2');
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/**
 * root: the device repository; lockFile: relative to root; cacheEnv: an environment variable that may point at an existing
 * folder of fetched sources (reused, missing ones fetched into it). Default folder: <root>/.upstream.
 */
export function openUpstream({ root, lockFile = 'upstream.lock.json', cacheEnv = 'VHW_UPSTREAM_CACHE' }) {
  const lock = JSON.parse(readFileSync(path.join(root, lockFile), 'utf8'));
  const cacheRoot = () => path.resolve(process.env[cacheEnv] || path.join(root, '.upstream'));
  const sourcePath = (name) => {
    if (!lock.sources[name]) throw new Error(`${lockFile} has no source ${name}`);
    return path.join(cacheRoot(), name);
  };

  /** Problem with a source (missing, wrong commit, local changes), or null when it is exactly the pinned commit. */
  function check(name) {
    const dir = sourcePath(name);
    const want = lock.sources[name].commit;
    if (!existsSync(path.join(dir, '.git'))) return `${name} is missing (${dir})`;
    const head = git(dir, 'rev-parse', 'HEAD');
    if (head !== want) return `${name} is at ${head.slice(0, 7)}, expected ${want.slice(0, 7)}`;
    if (git(dir, 'status', '--porcelain', '--untracked-files=no')) return `${name} has local changes (upstream code must stay as it is)`;
    return null;
  }

  /** Fetch a source at its pinned commit (skipped when already right). Never overwrites an existing checkout. */
  function ensure(name, log = console.log) {
    if (!check(name)) { log(`  ✓ ${name} @ ${lock.sources[name].commit.slice(0, 7)}`); return; }
    const dir = sourcePath(name);
    const src = lock.sources[name];
    if (existsSync(path.join(dir, '.git'))) throw new Error(`${check(name)}. Fix or delete that folder and run again.`);
    log(`  ↓ ${name} @ ${src.commit.slice(0, 7)} …`);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', src.url);
    if (src.sparse) git(dir, 'sparse-checkout', 'set', ...src.sparse);
    git(dir, 'fetch', '-q', '--depth', '1', 'origin', src.commit);
    git(dir, 'checkout', '-q', '--detach', 'FETCH_HEAD');
    const again = check(name);
    if (again) throw new Error(again);
  }

  const sourcesFor = (device) => Object.entries(lock.sources).filter(([, s]) => (s.usedBy ?? []).includes(device)).map(([n]) => n);

  return { lock, path: sourcePath, check, ensure, sourcesFor };
}
