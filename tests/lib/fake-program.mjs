// A fake computer-side program for tests: a WebSocket server on 127.0.0.1 that records what the device sends and can send bytes.
import http from 'node:http';
import { acceptWebSocket } from '../../tools/dev-bridge/ws-server.mjs';

export async function startFakeProgram({ port = 0, path = '/' } = {}) {
  const received = [];
  const origins = [];
  let client = null;
  const waiters = new Set();
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== path) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    origins.push(req.headers.origin ?? null);
    const ws = acceptWebSocket(req, socket);
    client = ws;
    ws.on('message', (m) => { if (typeof m !== 'string') { received.push(...m); for (const w of waiters) w(); } });
    ws.on('close', () => { if (client === ws) client = null; });
    for (const w of waiters) w();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const until = (check, ms = 5000) => new Promise((resolve, reject) => {
    if (check()) { resolve(); return; }
    const t = setTimeout(() => { waiters.delete(w); reject(new Error('fake program: timed out')); }, ms);
    const w = () => { if (check()) { clearTimeout(t); waiters.delete(w); resolve(); } };
    waiters.add(w);
  });
  return {
    port: server.address().port,
    received,
    origins,
    get connected() { return !!client; },
    waitForClient: (ms) => until(() => !!client, ms),
    waitForBytes: (n, ms) => until(() => received.length >= n, ms),
    send: (bytes) => client.send(bytes),
    dropClient() { client?.close(1001, 'bye'); client = null; },
    close: () => new Promise((r) => { client?.close(1001, 'bye'); server.close(r); server.closeAllConnections?.(); }),
  };
}
