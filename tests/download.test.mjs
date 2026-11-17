// Downloading a package on a flaky network: a file that stops arriving (no bytes for a while) or whose connection breaks is fetched
// again from where it stopped (HTTP Range), a few times with a growing pause; when nothing more comes, the load fails with code
// 'download_failed' so the page can offer to try again. The sha256 check after the download still covers every byte.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { downloadFile, loadPackage } from '../src/runtime/index.mjs';
import { unpackFixture } from './lib/test-device.mjs';

const cleanup = [];
after(async () => { for (const c of cleanup.reverse()) await c(); });

/**
 * A file server with Range support whose first `bad` responses misbehave after `cut` bytes of the body: 'stall' (the connection
 * stays open, nothing more comes) or 'drop' (the connection breaks). ignoreRange: always the whole file (200). Records each request's Range.
 */
async function flakyServer(routes, { bad = 1, cut = 1000, how = 'stall', ignoreRange = false } = {}) {
  const ranges = [];
  let misbehaved = 0;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url, 'http://x').pathname];
    if (!body) { res.writeHead(404); res.end(); return; }
    ranges.push(req.headers.range ?? null);
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const start = m && !ignoreRange ? Number(m[1]) : 0;
    const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: '"v1"', 'Content-Length': body.length - start };
    if (start) headers['Content-Range'] = `bytes ${start}-${body.length - 1}/${body.length}`;
    res.writeHead(start ? 206 : 200, headers);
    const part = body.subarray(start);
    if (misbehaved < bad && part.length > cut) {
      misbehaved++;
      res.write(part.subarray(0, cut));
      if (how === 'drop') setTimeout(() => res.socket.destroy(), 20);
      return; // 'stall': never another byte
    }
    res.end(part);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }));
  return { base: `http://127.0.0.1:${server.address().port}`, ranges };
}

async function fixtureRoutes() {
  const { description, files } = await unpackFixture();
  const routes = {};
  const paths = {};
  for (const [p, bytes] of files) { const key = `/f/${p.replace(/\W/g, '')}`; routes[key] = Buffer.from(bytes); paths[p] = key; }
  return { description, files, routes, paths };
}
const urlsOf = (paths, base) => Object.fromEntries(Object.entries(paths).map(([p, k]) => [p, base + k]));
const FAST = { stallMs: 150, retryDelayMs: 5 };

test('a file that stops arriving is fetched again from where it stopped, and the package is complete', async () => {
  const { description, files, routes, paths } = await fixtureRoutes();
  const { base, ranges } = await flakyServer(routes, { how: 'stall', cut: 1000 });
  const progress = [];
  const retries = [];
  const pkg = await loadPackage({ description, fileUrls: urlsOf(paths, base) }, { ...FAST, onProgress: (p) => progress.push(p.loaded), onRetry: (r) => retries.push(r) });
  assert.deepEqual([...pkg.files.keys()].sort(), [...files.keys()].sort());
  assert.ok(ranges.includes('bytes=1000-'), `resumed with Range: ${JSON.stringify(ranges)}`);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].loaded, 1000);
  assert.equal(retries[0].reason, 'stalled');
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1], 'progress never goes back when resuming');
});

test('a connection that breaks mid-file is resumed the same way', async () => {
  const { description, files, routes, paths } = await fixtureRoutes();
  const { base, ranges } = await flakyServer(routes, { how: 'drop', cut: 2000, bad: 2 });
  const pkg = await loadPackage({ description, fileUrls: urlsOf(paths, base) }, FAST);
  assert.deepEqual([...pkg.files.keys()].sort(), [...files.keys()].sort());
  assert.ok(ranges.includes('bytes=2000-'), JSON.stringify(ranges));
});

test('a server that ignores Range sends the whole file again, and that is used from the start', async () => {
  const { description, files, routes, paths } = await fixtureRoutes();
  const { base } = await flakyServer(routes, { how: 'stall', ignoreRange: true });
  const pkg = await loadPackage({ description, fileUrls: urlsOf(paths, base) }, FAST);
  for (const [p, bytes] of files) assert.deepEqual(pkg.files.get(p), bytes);
});

test('when tries bring nothing more, the load fails with download_failed after the given number of retries', async () => {
  const { base, ranges } = await flakyServer({ '/big': Buffer.alloc(50_000, 7) }, { how: 'stall', cut: 0, bad: 100 });
  const retries = [];
  await assert.rejects(downloadFile(`${base}/big`, { ...FAST, retries: 3, onRetry: (r) => retries.push(r.attempt) }), (err) => {
    assert.equal(err.code, 'download_failed');
    assert.match(err.message, /\/big/);
    return true;
  });
  assert.equal(ranges.length, 4);
  assert.deepEqual(retries, [1, 2, 3]);
});

test('tries that each bring more bytes go on until the file is complete (a slow, flaky network is not given up on)', async () => {
  const body = Buffer.from(Array.from({ length: 20_000 }, (_, i) => i % 251));
  const { base } = await flakyServer({ '/f': body }, { how: 'drop', cut: 1500, bad: 8 });
  const got = await downloadFile(`${base}/f`, { ...FAST, retries: 2, size: body.length });
  assert.deepEqual(Buffer.from(got), body);
});

test('an HTTP error that will not change (404) fails at once, without retrying', async () => {
  const { base, ranges } = await flakyServer({});
  await assert.rejects(downloadFile(`${base}/missing`, FAST), (err) => err.code === 'download_failed' && /404/.test(err.message));
  assert.equal(ranges.length, 0); // the 404 route is answered before recording
});
