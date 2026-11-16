#!/usr/bin/env node
// Development bridge: stands in for a computer-side program that does not have the "virtual device" connection yet.
// It listens where the program would (ws://127.0.0.1:<port><path> from the device description), takes the page's
// connection, and relays the bytes to a pseudo-terminal (pty_relay.py) that the unchanged program opens as a USB serial port.
// Development only (macOS / Linux); visitors use the program's own virtual device connection instead.
//
//   node tools/dev-bridge/bridge.mjs --port=47615 [--path=/] --tty=<path of the serial port link> [--origin=<allowed origin>…]
//
// - Listens on 127.0.0.1 only. Accepts pages from http://127.0.0.1:* and http://localhost:* (and any --origin), and clients
//   without an Origin (local programs, tests); refuses other web pages.
// - One page at a time: a new page replaces the previous one (close code 4000).
// - Binary messages are the bytes as they are, both ways.
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptWebSocket, rejectUpgrade } from './ws-server.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

/** Start the bridge. Returns { port, ttyPath, close() }. */
export async function startBridge({ port, wsPath = '/', ttyPath, origins = [], python = process.env.PYTHON || 'python3', log = console.log }) {
  let client = null;
  const relay = spawn(python, [path.join(here, 'pty_relay.py'), ttyPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  relay.stdout.on('data', (d) => client?.send(new Uint8Array(d.buffer, d.byteOffset, d.length)));
  relay.stdin.on('error', () => {});
  await new Promise((resolve, reject) => {
    let err = '';
    relay.stderr.setEncoding('utf8');
    relay.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        let ev;
        try { ev = JSON.parse(line); } catch { err += `${line}\n`; continue; }
        if (ev.event === 'ready') { log(`[bridge] serial port ${ev.link} → ${ev.tty}`); resolve(); }
        else if (ev.event === 'dropped') log(`[bridge] ${ev.reason}`);
      }
    });
    relay.once('error', reject);
    relay.once('exit', (code) => { if (code) reject(new Error(`pty_relay.py exited (${code}): ${err.trim()}`)); });
  });

  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin;
    if (origin && !LOOPBACK_ORIGIN.test(origin) && !origins.includes(origin)) return rejectUpgrade(socket, 403, 'Forbidden');
    if (new URL(req.url, 'http://x').pathname !== wsPath) return rejectUpgrade(socket, 404, 'Not Found');
    const ws = acceptWebSocket(req, socket);
    if (!ws) return;
    if (client) client.close(4000, 'replaced');
    client = ws;
    log(`[bridge] page connected (${origin ?? 'no origin'})`);
    ws.on('message', (msg) => { if (typeof msg !== 'string') relay.stdin.write(msg); });
    ws.on('close', () => { if (client === ws) { client = null; log('[bridge] page disconnected'); } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });

  return {
    port: server.address().port,
    ttyPath,
    async close() {
      client?.close(1001, 'bridge stopping');
      const exited = new Promise((r) => relay.once('exit', r));
      relay.stdin.end();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
      relay.kill();
      await new Promise((r) => server.close(r));
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const port = Number(arg('port'));
  const ttyPath = arg('tty');
  if (!port || !ttyPath) { console.error('usage: bridge.mjs --port=<port> --tty=<path> [--path=/] [--origin=<origin>…]'); process.exit(2); }
  const origins = args.filter((a) => a.startsWith('--origin=')).map((a) => a.slice(9));
  const bridge = await startBridge({ port, wsPath: arg('path') ?? '/', ttyPath: path.resolve(ttyPath), origins });
  console.log(`[bridge] ws://127.0.0.1:${bridge.port}${arg('path') ?? '/'} ⇄ ${bridge.ttyPath}`);
  const stop = async () => { await bridge.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
