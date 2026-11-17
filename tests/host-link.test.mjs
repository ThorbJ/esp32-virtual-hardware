// The web runtime's computer connection: straight to the local program's WebSocket, bytes as they are (no bridge).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { connectHostLink } from '../src/runtime/host-link.mjs';
import { powerOnTestDevice } from './lib/test-device.mjs';
import { startFakeProgram } from './lib/fake-program.mjs';

const cleanup = [];
after(async () => { for (const c of cleanup.reverse()) await c(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('connects to the local program, and bytes go both ways unchanged (the test device echoes)', async () => {
  const program = await startFakeProgram();
  cleanup.push(() => program.close());
  const { dev } = await powerOnTestDevice();
  cleanup.push(() => dev.powerOff());
  const states = [];
  const traffic = [];
  const link = connectHostLink(dev, { url: `ws://127.0.0.1:${program.port}/`, onState: (s) => states.push(s), onTraffic: (dir, b) => traffic.push([dir, b.length]) });
  cleanup.push(() => link.close());
  await program.waitForClient();
  while (!link.connected) await sleep(10);
  const bytes = Uint8Array.from([0x44, 0x42, 0x00, 0xff, 0x0a, 0x7f, 0x80]);
  program.send(bytes);
  await program.waitForBytes(bytes.length);
  assert.deepEqual(program.received, [...bytes]);
  assert.deepEqual(states.slice(0, 2), ['waiting', 'connected']);
  assert.deepEqual(traffic.slice(0, 2), [['rx', 7], ['tx', 7]]);
});

test('without the program the device runs as if unplugged, and connects once the program starts (no reload)', async () => {
  const probe = await startFakeProgram();
  const port = probe.port;
  await probe.close(); // a free port with nobody listening
  const { dev } = await powerOnTestDevice();
  cleanup.push(() => dev.powerOff());
  const states = [];
  const link = connectHostLink(dev, { url: `ws://127.0.0.1:${port}/`, retryMs: 100, onState: (s) => states.push(s) });
  cleanup.push(() => link.close());
  await sleep(400);
  assert.equal(link.connected, false);
  assert.equal(link.state, 'waiting');
  assert.ok(link.attempts >= 2, `retries while waiting: ${link.attempts}`);
  const program = await startFakeProgram({ port });
  cleanup.push(() => program.close());
  await program.waitForClient(3000);
  program.send(Uint8Array.from([1, 2, 3]));
  await program.waitForBytes(3);
  assert.equal(link.state, 'connected');
});

test('when the program goes away the device is unplugged and the link waits again', async () => {
  const program = await startFakeProgram();
  cleanup.push(() => program.close());
  const { dev, tx } = await powerOnTestDevice();
  cleanup.push(() => dev.powerOff());
  const link = connectHostLink(dev, { url: `ws://127.0.0.1:${program.port}/`, retryMs: 100 });
  cleanup.push(() => link.close());
  await program.waitForClient();
  while (!link.connected) await sleep(10);
  program.dropClient();
  while (link.connected) await sleep(10);
  assert.equal(link.state, 'waiting');
  assert.equal(dev.hostPresent, false);
  await program.waitForClient(3000); // comes back by itself
});

test('when the browser refuses to even create the socket, every retry is reported with its attempt count', async () => {
  const dev = { on: () => () => {}, setHostPresent: () => {}, hostWrite: () => {} };
  class Blocked { constructor() { throw new DOMException('blocked by the browser', 'SecurityError'); } }
  const reports = [];
  const link = connectHostLink(dev, { url: 'ws://127.0.0.1:47615/', retryMs: 5, WebSocketImpl: Blocked, onState: (s, info) => reports.push([s, info.attempts]) });
  cleanup.push(() => link.close());
  while (link.attempts < 5) await sleep(5);
  link.close();
  const waiting = reports.filter(([s]) => s === 'waiting').map(([, n]) => n);
  for (const n of [1, 2, 3, 4]) assert.ok(waiting.includes(n), `attempt ${n} reported: ${JSON.stringify(reports)}`);
  assert.equal(link.state, 'closed');
});

// Desktop programs take one virtual device at a time and a newer connection replaces the older one: two tabs of the same page
// would knock each other off every retry. A link holds the browser's lock for its address (Web Locks: one per origin, shared by
// every tab), so only one tab connects; the others wait without trying, and one of them can take the connection over.
const unplugged = () => ({ on: () => () => {}, setHostPresent: () => {}, hostWrite: () => {} });
const untilState = async (link, s, ms = 3000) => { const end = Date.now() + ms; while (link.state !== s) { if (Date.now() > end) throw new Error(`timed out waiting for ${s}, state ${link.state}`); await sleep(5); } };

test('two pages with the same device: only one connects, the other waits without trying and can take the connection over', async () => {
  const program = await startFakeProgram();
  cleanup.push(() => program.close());
  const url = `ws://127.0.0.1:${program.port}/`;
  const first = connectHostLink(unplugged(), { url, retryMs: 20 });
  cleanup.push(() => first.close());
  await untilState(first, 'connected');
  const states = [];
  const second = connectHostLink(unplugged(), { url, retryMs: 20, onState: (s) => states.push(s) });
  cleanup.push(() => second.close());
  await untilState(second, 'elsewhere');
  await sleep(200);
  assert.equal(program.origins.length, 1, 'the second page never opened a socket');
  assert.equal(second.attempts, 0);
  assert.deepEqual(states, ['elsewhere']);

  second.takeOver();
  await untilState(second, 'connected');
  await untilState(first, 'elsewhere');
  await sleep(200);
  assert.equal(program.origins.length, 2, 'the page that lost the connection does not try again');

  // The page holding the connection goes away (closed tab, version switch): the waiting one connects by itself.
  second.close();
  await untilState(first, 'connected');
  assert.equal(program.origins.length, 3);
});

test('without Web Locks (or with locks: null) a link connects as before', async () => {
  const program = await startFakeProgram();
  cleanup.push(() => program.close());
  const url = `ws://127.0.0.1:${program.port}/`;
  const a = connectHostLink(unplugged(), { url, retryMs: 20, locks: null });
  const b = connectHostLink(unplugged(), { url, retryMs: 20, locks: null });
  cleanup.push(() => a.close(), () => b.close());
  await sleep(100);
  assert.ok(program.origins.length >= 2);
  b.takeOver(); // nothing to take over: no-op
});
