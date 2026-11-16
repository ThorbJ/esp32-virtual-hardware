// Minimal WebSocket server (RFC 6455) for development tools and tests: binary and text messages, ping/pong, close.
// No dependencies; no extensions (permessage-deflate etc.).
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Call from an http server's 'upgrade' event: accepts the handshake and returns the connection. */
export function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  return new WsConnection(socket);
}

export function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\n\r\n`);
}

class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.open = true;
    this.handlers = { message: [], close: [] };
    this.buf = Buffer.alloc(0);
    this.fragments = null;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  on(ev, fn) { this.handlers[ev].push(fn); }

  /** data: Uint8Array → binary message; string → text message. */
  send(data) {
    if (!this.open) return;
    const text = typeof data === 'string';
    this._frame(text ? 0x1 : 0x2, text ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this._frame(0x8, body);
    this.socket.end();
    this._closed();
  }

  _frame(opcode, payload) {
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | opcode, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[maskOff + (i & 3)];
      this.buf = b.subarray(off + len);
      this._onFrame(fin, opcode, payload);
      if (!this.open) return;
    }
  }

  _onFrame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(); return; }
    if (opcode === 0x9) { this._frame(0xa, payload); return; }
    if (opcode === 0xa) return;
    if (opcode === 0x1 || opcode === 0x2) this.fragments = { text: opcode === 0x1, parts: [payload] };
    else if (opcode === 0x0 && this.fragments) this.fragments.parts.push(payload);
    else return;
    if (!fin) return;
    const all = Buffer.concat(this.fragments.parts);
    const msg = this.fragments.text ? all.toString('utf8') : new Uint8Array(all.buffer, all.byteOffset, all.length);
    this.fragments = null;
    for (const fn of this.handlers.message) fn(msg);
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    for (const fn of this.handlers.close) fn();
  }
}
