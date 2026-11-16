// The web runtime's device-independent interface: given a package and a viewer, it loads, wires everything and reports status.
// Node runs the same code as the browser; only the firmware module is loaded from a file (Node cannot import blob: URLs).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loadPackage, startVirtualDevice } from '../src/runtime/index.mjs';
import { loadFirmwareFile } from '../src/interface/node-loader.mjs';
import { FIXTURE, unpackFixture } from './lib/test-device.mjs';
import { fakeViewer } from './lib/fake-viewer.mjs';
import { startFakeProgram } from './lib/fake-program.mjs';

const cleanup = [];
after(async () => { for (const c of cleanup.reverse()) await c(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms = 10_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await sleep(10); } };

async function serve(routes) {
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url, 'http://x').pathname];
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function start(extra = {}) {
  const { dir, description, files } = await unpackFixture();
  const viewer = fakeViewer();
  const statuses = [];
  const session = await startVirtualDevice({
    pkg: { description, files }, viewer, hostLink: false,
    firmwareFactory: await loadFirmwareFile(path.join(dir, description.runtime.module)),
    onStatus: (s) => statuses.push(structuredClone(s)),
    ...extra,
  });
  cleanup.push(() => session.dispose());
  return { session, viewer, statuses, description };
}

test('loadPackage from an archive URL reports progress and checks every file', async () => {
  const base = await serve({ '/p.vdpkg.tgz': readFileSync(FIXTURE) });
  const progress = [];
  const pkg = await loadPackage({ archiveUrl: `${base}/p.vdpkg.tgz` }, { onProgress: (p) => progress.push(p) });
  assert.equal(pkg.description.device.id, 'test-device');
  assert.ok(pkg.files.get('firmware/test-device.wasm').byteLength > 1000);
  assert.ok(progress.length >= 1);
  assert.equal(progress.at(-1).loaded, progress.at(-1).total);
});

test('loadPackage from expanded files (any URLs, e.g. server-made storage keys) checks sizes and sha256', async () => {
  const { description, files } = await unpackFixture();
  const routes = {};
  const fileUrls = {};
  for (const [p, bytes] of files) { const key = `/media/${p.length}-${p.replace(/\W/g, '')}`; routes[key] = Buffer.from(bytes); fileUrls[p] = key; }
  const base = await serve(routes);
  const pkg = await loadPackage({ description, fileUrls: Object.fromEntries(Object.entries(fileUrls).map(([p, k]) => [p, base + k])) });
  assert.deepEqual([...pkg.files.keys()].sort(), [...files.keys()].sort());

  const bad = { ...routes, [fileUrls['firmware/test-device.wasm']]: Buffer.from(routes[fileUrls['firmware/test-device.wasm']]).fill(1, 100, 101) };
  const base2 = await serve(bad);
  await assert.rejects(loadPackage({ description, fileUrls: Object.fromEntries(Object.entries(fileUrls).map(([p, k]) => [p, base2 + k])) }), /sha256/);
});

test('powers on, draws the screen on the screen node, and reports running', async () => {
  const { session, viewer, statuses } = await start();
  await until(() => viewer.images.length > 3);
  const img = viewer.images.at(-1);
  assert.equal(img.node, 'screen');
  assert.equal(img.width, 160);
  assert.equal(img.height, 128);
  assert.equal(session.status.phase, 'running');
  assert.deepEqual([...new Set(statuses.map((s) => s.phase))], ['starting', 'running']);
});

test('clicking the button node presses the button: the part moves in, the picture changes, the servo turns its parts', async () => {
  const { session, viewer } = await start();
  await until(() => viewer.images.length > 3 && viewer.rotations.has('arm'));
  assert.equal(viewer.rotations.get('arm').angleDeg, -0.09); // 90° at boot: duty 1228/16384 of 20 ms = 1499 µs = 89.91°
  assert.ok(viewer.pickable.includes('button'));
  viewer.pick('button', 'down');
  assert.deepEqual(viewer.offsets.get('button'), [0, 0, -1.5]);
  viewer.pick('button', 'up');
  await until(() => viewer.offsets.get('button') === null);
  await until(() => { const [r, , b] = viewer.lastPixel(80, 100); return r > 200 && b < 40; });
  await until(() => Math.abs(viewer.rotations.get('arm').angleDeg - 60) < 0.5);
  assert.deepEqual(viewer.rotations.get('arm').pivot, [20, 69, 0]);
  assert.deepEqual(viewer.rotations.get('arm').axis, [0, 1, 0]);
  await until(() => session.log.includes('button pressed (1)'));
});

test('repower starts the firmware again from the beginning', async () => {
  const { session } = await start();
  await until(() => session.log.includes('boot v0.1.0'));
  await session.repower();
  assert.equal(session.status.bootCount, 2);
  await until(() => session.log.includes('boot v0.1.0'));
});

test('connects to the local program on the port in the description and reports the link state and traffic', async () => {
  const program = await startFakeProgram();
  cleanup.push(() => program.close());
  const traffic = [];
  const { session } = await start({ hostLink: { url: `ws://127.0.0.1:${program.port}/` } });
  session.on('traffic', (t) => traffic.push(t.direction));
  await until(() => session.status.link === 'connected');
  program.send(Uint8Array.from([9, 8, 7]));
  await program.waitForBytes(3);
  assert.deepEqual(traffic.slice(0, 2), ['rx', 'tx']);
});

test('dispose powers off and reports off', async () => {
  const { session } = await start();
  await until(() => session.status.phase === 'running');
  await session.dispose();
  assert.equal(session.status.phase, 'off');
});
