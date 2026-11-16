// The development bridge: page WebSocket ⇄ pseudo-terminal (a program opening the "serial port" sees the device's bytes).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startBridge } from '../tools/dev-bridge/bridge.mjs';

test('bytes from the page reach the serial port and back; foreign web pages are refused', { skip: process.platform === 'win32' }, async () => {
  const tty = path.join(mkdtempSync(path.join(tmpdir(), 'vhw-bridge-')), 'device.tty');
  const bridge = await startBridge({ port: 0, ttyPath: tty, log: () => {} });
  try {
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, { headers: { Origin: 'https://example.com' } });
      ws.onopen = () => resolve(false);
      ws.onerror = () => resolve(true);
    });
    assert.equal(refused, true);

    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`);
    ws.binaryType = 'arraybuffer';
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const port = await open(tty, 'r+'); // what the computer-side program does (async: the bridge runs in this process)
    ws.send(Uint8Array.from([0xde, 0xad, 0x00, 0x0a]));
    const buf = Buffer.alloc(16);
    let n = 0;
    while (n < 4) n += (await port.read(buf, n, 16 - n)).bytesRead;
    assert.deepEqual([...buf.subarray(0, 4)], [0xde, 0xad, 0x00, 0x0a]);
    const back = new Promise((r) => { ws.onmessage = (e) => r([...new Uint8Array(e.data)]); });
    await port.write(Buffer.from([1, 2, 3]));
    assert.deepEqual(await back, [1, 2, 3]);
    await port.close();
    ws.close();
  } finally {
    await bridge.close();
  }
});
