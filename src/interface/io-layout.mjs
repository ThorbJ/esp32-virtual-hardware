// Word numbers of the exchange area on the JS side; must match vdev_io_t in vhw/include/vdev_io.h (change both together).
export const MAGIC = 0x56444556;
export const VERSION = 3;
export const WORDS = 64;

export const W = Object.freeze({
  magic: 0, version: 1, wordCount: 2, power: 3, powerReason: 4,
  screenTimeMs: 5, screenAck: 6, clockMs: 7,
  rings: 8, // 4 words per ring: data, cap, head, tail
  screenPtr: 36, screenWidth: 37, screenHeight: 38, screenFormat: 39, screenSeq: 40, screenOn: 41,
  speakerRate: 42, speakerChannels: 43,
  micRate: 44, micChannels: 45, micLive: 46,
  camReqSeq: 47, camReqWidth: 48, camReqHeight: 49, camReqFormat: 50,
  camBuf: 51, camCap: 52, camLen: 53, camSeq: 54,
  hostPresent: 55,
  buttons: 56, joyX: 57, joyY: 58,
  macLo: 59, macHi: 60,
  clockHoldMs: 61, clockParked: 62,
});

export const RING = Object.freeze({ log: 0, hostTx: 1, hostRx: 2, servo: 3, speaker: 4, mic: 5, input: 6 });
export const POWER = Object.freeze({ off: 0, running: 1, restart: 2, halted: 3 });
export const PIXEL = Object.freeze({ 1: 'rgb565' });
export const CAMERA_FORMAT = Object.freeze({ 1: 'jpeg', 2: 'rgb565' });
export const INPUT = Object.freeze({ button: 1, joystick: 2, touch: 3 });
export const TOUCH_PHASE = Object.freeze({ down: 1, move: 2, up: 3 });

/** Single-producer / single-consumer ring buffer in the exchange area (JS side). */
export class Ring {
  constructor(heapU8, heapU32, ioWord, index) {
    this.u8 = heapU8;
    this.u32 = heapU32;
    this.base = ioWord + W.rings + index * 4;
    this.data = heapU32[this.base];
    this.cap = heapU32[this.base + 1];
  }
  get head() { return Atomics.load(this.u32, this.base + 2) >>> 0; }
  get tail() { return Atomics.load(this.u32, this.base + 3) >>> 0; }
  readable() { return (this.head - this.tail) >>> 0; }
  writable() { return this.cap - this.readable(); }

  /** Read all readable bytes (a copy). */
  drain(max = Infinity) {
    const tail = this.tail;
    const n = Math.min((this.head - tail) >>> 0, max);
    if (n === 0) return null;
    const out = new Uint8Array(n);
    const pos = tail & (this.cap - 1);
    const first = Math.min(n, this.cap - pos);
    out.set(this.u8.subarray(this.data + pos, this.data + pos + first), 0);
    if (n > first) out.set(this.u8.subarray(this.data, this.data + n - first), first);
    Atomics.store(this.u32, this.base + 3, (tail + n) >>> 0);
    return out;
  }

  /** Write bytes; writes what fits and returns how many. */
  write(bytes) {
    const head = this.head;
    const n = Math.min(bytes.length, this.cap - ((head - this.tail) >>> 0));
    const pos = head & (this.cap - 1);
    const first = Math.min(n, this.cap - pos);
    this.u8.set(bytes.subarray(0, first), this.data + pos);
    if (n > first) this.u8.set(bytes.subarray(first, n), this.data);
    Atomics.store(this.u32, this.base + 2, (head + n) >>> 0);
    return n;
  }
}
