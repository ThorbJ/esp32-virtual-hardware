// Pure computations of the web runtime (no DOM, no three.js): what the screen texture looks like, where a click on the screen
// lands on the panel, how far a servo turns its parts, where the joystick is pushed. The viewer only shows images, turns and
// moves nodes and reports clicks; everything device-specific comes from the device description.

const MAX_TEXTURE = 2048;

const quarterOf = (rotateCW) => (((rotateCW ?? 0) % 360) + 360) % 360 / 90;

/** Size of the picture as people see it (the panel turned clockwise by rotateCW). */
function viewSize(panel, q) {
  return q % 2 ? { w: panel.height, h: panel.width } : { w: panel.width, h: panel.height };
}

/** View pixel (x, y) → native panel pixel { col, row }. */
function viewToPanel(panel, q, x, y) {
  switch (q) {
    case 1: return { col: y, row: panel.height - 1 - x };
    case 2: return { col: panel.width - 1 - x, row: panel.height - 1 - y };
    case 3: return { col: panel.width - 1 - y, row: x };
    default: return { col: x, row: y };
  }
}

function parseColor(hex = '#000000') {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The screen texture of a device description's `screen`: an RGBA image in glTF texture space (origin top-left, rows going
 * down) for the whole material of the screen node. The panel's picture fills screen.area; the rest is screen.background.
 * update(frame) redraws it from an interface screen frame (RGB565, native panel direction). Returns
 * { width, height, data: Uint8ClampedArray, update(frame) }; data is the same buffer every time.
 */
export function createScreenImage(screen) {
  const { panel, area } = screen;
  const q = quarterOf(screen.rotateCW);
  const view = viewSize(panel, q);
  let width = Math.max(1, Math.round(view.w / area.width));
  let height = Math.max(1, Math.round(view.h / area.height));
  const shrink = Math.min(1, MAX_TEXTURE / Math.max(width, height));
  width = Math.max(1, Math.round(width * shrink));
  height = Math.max(1, Math.round(height * shrink));
  const data = new Uint8ClampedArray(width * height * 4);
  const [br, bg, bb] = parseColor(screen.background);
  for (let i = 0; i < width * height; i++) data.set([br, bg, bb, 255], i * 4);

  const ax = Math.round(area.x * width);
  const ay = Math.round(area.y * height);
  const aw = Math.max(1, Math.round(area.width * width));
  const ah = Math.max(1, Math.round(area.height * height));
  // texture pixel inside the area → native panel pixel index
  const target = new Uint32Array(aw * ah);
  const offset = new Uint32Array(aw * ah);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const vx = Math.min(view.w - 1, Math.floor((x / aw) * view.w));
      const vy = Math.min(view.h - 1, Math.floor((y / ah) * view.h));
      const { col, row } = viewToPanel(panel, q, vx, vy);
      target[y * aw + x] = row * panel.width + col;
      offset[y * aw + x] = ((ay + y) * width + ax + x) * 4;
    }
  }

  function update(frame) {
    const px = frame.pixels;
    for (let i = 0; i < target.length; i++) {
      const p = px[target[i]];
      const o = offset[i];
      data[o] = ((p >> 11) & 31) * 255 / 31;
      data[o + 1] = ((p >> 5) & 63) * 255 / 63;
      data[o + 2] = (p & 31) * 255 / 31;
    }
  }

  return { width, height, data, update };
}

/**
 * A point on the screen node's material in glTF texture coordinates [u, v] (0..1, origin top-left: what three.js reports for
 * glTF meshes) → native panel pixel { x, y } for the interface's touch(), or null outside screen.area.
 */
export function uvToPanel(screen, [u, v]) {
  const { panel, area } = screen;
  const q = quarterOf(screen.rotateCW);
  const view = viewSize(panel, q);
  const vx = Math.floor(((u - area.x) / area.width) * view.w);
  const vy = Math.floor(((v - area.y) / area.height) * view.h);
  if (!(vx >= 0 && vy >= 0 && vx < view.w && vy < view.h)) return null;
  const { col, row } = viewToPanel(panel, q, vx, vy);
  return { x: col, y: row };
}

/** How far a servo's parts turn from their place in the Kit model, in degrees, for a servo angle (description servos[]). */
export function servoJointAngle(servo, angleDeg) {
  let a = servo.direction * servo.scale * (angleDeg - servo.zeroDeg);
  if (servo.minDeg !== undefined) a = Math.max(servo.minDeg, a);
  if (servo.maxDeg !== undefined) a = Math.min(servo.maxDeg, a);
  return Math.round(a * 1e6) / 1e6 + 0;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

/** A clicked point on the joystick cap (model coordinates, mm) and the cap's centre → { x, y } in -1..1 for setJoystick. */
export function joystickFromPoint(joystick, point, center) {
  const d = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
  let x = dot(d, joystick.right) / len(joystick.right) / joystick.radiusMm;
  let y = dot(d, joystick.up) / len(joystick.up) / joystick.radiusMm;
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  const tidy = (n) => Math.round(n * 1000) / 1000 + 0;
  return { x: tidy(x), y: tidy(y) };
}
