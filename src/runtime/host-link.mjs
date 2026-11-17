// The computer connection of a virtual device: the device's computer byte stream (hostTx / hostRx / hostPresent) goes straight
// to the computer-side program's local WebSocket (ws://127.0.0.1:<port><path> from the device description). Binary messages
// carry the bytes exactly as they are, both ways; text messages are ignored. Device independent; browser and Node 22+.
//
// While the socket is open the device is "plugged in" (hostPresent); otherwise it runs like a real one not plugged into a
// computer, and the link keeps trying, so starting the program later connects without a reload.
//
//   const link = connectHostLink(dev, { url: 'ws://127.0.0.1:47615/', onState, onTraffic });
//   link.state  // 'waiting' (trying to reach the program) | 'connected' | 'closed' (after close())

export function hostLinkUrl(hostLink) {
  return `ws://127.0.0.1:${hostLink.port}${hostLink.path ?? '/'}`;
}

/**
 * onState(state, { url, attempts, code }): on every change, and again ('waiting' with the new count) after every failed attempt, whether the
 * socket closed (code: its close code) or the browser refused to create it at all (no code; e.g. local network access blocked).
 * onTraffic(direction, bytes): 'rx' = computer → device, 'tx' = device → computer.
 * retryMs: wait between attempts while the program is not there.
 */
export function connectHostLink(dev, { url, onState = () => {}, onTraffic = () => {}, retryMs = 2000, WebSocketImpl = globalThis.WebSocket }) {
  let ws = null;
  let state = null;
  let attempts = 0;
  let stopped = false;
  let retryTimer = null;

  const setState = (s, extra = {}) => {
    if (s === state) return;
    state = s;
    onState(s, { url, attempts, ...extra });
  };

  const offTx = dev.on('hostTx', (bytes) => {
    if (ws?.readyState !== 1) return; // not connected: what the device sends is lost, like an unplugged cable
    ws.send(bytes);
    onTraffic('tx', bytes);
  });

  const open = () => {
    if (stopped) return;
    attempts++;
    setState('waiting');
    let sock;
    try {
      sock = new WebSocketImpl(url);
    } catch {
      state = null; // report the failed attempt, so a page counting attempts sees this case too
      setState('waiting');
      retryTimer = setTimeout(open, retryMs);
      return;
    }
    ws = sock;
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      dev.setHostPresent(true);
      setState('connected');
    };
    sock.onmessage = (ev) => {
      if (typeof ev.data === 'string') return;
      const bytes = new Uint8Array(ev.data);
      dev.hostWrite(bytes);
      onTraffic('rx', bytes);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      dev.setHostPresent(false);
      if (stopped) return;
      state = null; // report 'waiting' again with the close code
      setState('waiting', { code: ev.code });
      retryTimer = setTimeout(open, retryMs);
    };
    sock.onerror = () => { /* onclose follows */ };
  };
  open();

  return {
    get state() { return state; },
    get connected() { return state === 'connected'; },
    get attempts() { return attempts; },
    url,
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      offTx();
      if (ws) { const s = ws; ws = null; s.close(); }
      dev.setHostPresent(false);
      setState('closed');
    },
  };
}
