// The computer connection of a virtual device: the device's computer byte stream (hostTx / hostRx / hostPresent) goes straight
// to the computer-side program's local WebSocket (ws://127.0.0.1:<port><path> from the device description). Binary messages
// carry the bytes exactly as they are, both ways; text messages are ignored. Device independent; browser and Node 22+.
//
// While the socket is open the device is "plugged in" (hostPresent); otherwise it runs like a real one not plugged into a
// computer, and the link keeps trying, so starting the program later connects without a reload.
//
// One page at a time: a computer-side program takes one device and a newer connection replaces the older one, so two tabs
// showing the same device would knock each other off on every retry. Where the browser has Web Locks (navigator.locks: shared
// by every tab of an origin), a link connects only while it holds the lock named after its address. A link that finds the lock
// held reports 'elsewhere' and opens no socket; it gets the lock (and connects) when the holder lets go, or at once with
// takeOver(), which leaves the former holder 'elsewhere' (it does not try to win it back).
//
//   const link = connectHostLink(dev, { url: 'ws://127.0.0.1:47615/', onState, onTraffic });
//   link.state  // 'waiting' (trying to reach the program) | 'connected' | 'elsewhere' (another page has it) | 'closed' (after close())
//   link.takeOver()  // connect here, taking the connection from the page that has it

export function hostLinkUrl(hostLink) {
  return `ws://127.0.0.1:${hostLink.port}${hostLink.path ?? '/'}`;
}

/** The Web Locks name a link to this address holds while it may connect. */
export const hostLinkLockName = (url) => `esp32-virtual-hardware host link ${url}`;

/**
 * onState(state, { url, attempts, code }): on every change, and again ('waiting' with the new count) after every failed attempt, whether the
 * socket closed (code: its close code) or the browser refused to create it at all (no code; e.g. local network access blocked).
 * attempts counts from the moment this page got the connection (again from 0 after taking it over).
 * onTraffic(direction, bytes): 'rx' = computer → device, 'tx' = device → computer.
 * retryMs: wait between attempts while the program is not there.
 * locks: the Web Locks manager (default navigator.locks); null: no lock, every link connects.
 */
export function connectHostLink(dev, { url, onState = () => {}, onTraffic = () => {}, retryMs = 2000, WebSocketImpl = globalThis.WebSocket, locks = globalThis.navigator?.locks ?? null }) {
  let ws = null;
  let state = null;
  let attempts = 0;
  let stopped = false;
  let retryTimer = null;
  let active = false; // this page may connect (holds the lock, or there is no lock)

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
    if (stopped || !active) return;
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
      if (ws !== sock) return;
      dev.setHostPresent(true);
      setState('connected');
    };
    sock.onmessage = (ev) => {
      if (ws !== sock || typeof ev.data === 'string') return;
      const bytes = new Uint8Array(ev.data);
      dev.hostWrite(bytes);
      onTraffic('rx', bytes);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      dev.setHostPresent(false);
      if (stopped || !active) return;
      state = null; // report 'waiting' again with the close code
      setState('waiting', { code: ev.code });
      retryTimer = setTimeout(open, retryMs);
    };
    sock.onerror = () => { /* onclose follows */ };
  };

  /** Stops connecting: the socket closed, no retry, the device unplugged. */
  const deactivate = () => {
    active = false;
    clearTimeout(retryTimer);
    if (ws) { const s = ws; ws = null; s.close(); }
    dev.setHostPresent(false);
  };

  // ---------- the lock ----------
  const name = hostLinkLockName(url);
  let request = 0; // the latest lock request; older ones' outcomes are ignored
  let holding = 0; // the request whose lock this page holds (0: none)
  let letGo = null; // resolves the held lock's callback: the lock is released
  let queued = null; // AbortController of a request waiting in the queue

  const hold = (id) => new Promise((release) => {
    if (stopped) { release(); return; }
    holding = id;
    letGo = release;
    active = true;
    attempts = 0;
    open();
  });
  const lost = (id) => (err) => {
    // A held lock taken over by another page, or a queued request we gave up (takeOver, close): AbortError either way.
    if (stopped || id !== holding) return;
    holding = 0;
    letGo = null;
    deactivate();
    setState('elsewhere');
    wait();
    if (err?.name !== 'AbortError') console.warn('host link lock', err);
  };
  const BUSY = Symbol('busy');
  /** Waits in the queue for the lock (no socket meanwhile). */
  const wait = () => {
    const id = ++request;
    queued = new AbortController();
    locks.request(name, { signal: queued.signal }, () => { queued = null; return hold(id); }).catch(lost(id));
  };
  const acquire = () => {
    const id = ++request;
    locks.request(name, { ifAvailable: true }, (lock) => (lock ? hold(id) : BUSY)).then((r) => {
      if (r !== BUSY || stopped) return;
      setState('elsewhere');
      wait();
    }, lost(id));
  };

  if (locks) acquire();
  else { active = true; open(); }

  return {
    get state() { return state; },
    get connected() { return state === 'connected'; },
    get attempts() { return attempts; },
    url,
    takeOver() {
      if (!locks || stopped || holding) return;
      queued?.abort();
      queued = null;
      const id = ++request;
      locks.request(name, { steal: true }, () => hold(id)).catch(lost(id));
    },
    close() {
      stopped = true;
      queued?.abort();
      queued = null;
      offTx();
      deactivate();
      letGo?.();
      letGo = null;
      holding = 0;
      setState('closed');
    },
  };
}
