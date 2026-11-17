import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScreenImage, uvToPanel, servoJointAngle, joystickFromPoint } from '../src/runtime/geometry.mjs';

const RED = 0xf800;
const BLUE = 0x001f;
const rgba = (img, i) => [...img.data.subarray(i * 4, i * 4 + 4)];

test('screen image: the panel picture turned clockwise and placed in the area, background elsewhere', () => {
  // Panel 2×1, red then blue; turned 90° clockwise it stands upright with red on top.
  const img = createScreenImage({ panel: { width: 2, height: 1, format: 'rgb565' }, rotateCW: 90, area: { x: 0, y: 0, width: 1, height: 1 } });
  assert.equal(img.width, 1);
  assert.equal(img.height, 2);
  img.update({ width: 2, height: 1, pixels: Uint16Array.from([RED, BLUE]) });
  assert.deepEqual(rgba(img, 0), [255, 0, 0, 255]);
  assert.deepEqual(rgba(img, 1), [0, 0, 255, 255]);
});

test('screen image: an area in the middle of the texture leaves a background border', () => {
  const img = createScreenImage({ panel: { width: 2, height: 2, format: 'rgb565' }, rotateCW: 0, area: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, background: '#102030' });
  assert.equal(img.width, 4);
  assert.equal(img.height, 4);
  img.update({ width: 2, height: 2, pixels: Uint16Array.from([RED, RED, RED, RED]) });
  assert.deepEqual(rgba(img, 0), [0x10, 0x20, 0x30, 255]);
  assert.deepEqual(rgba(img, 5), [255, 0, 0, 255]); // (1, 1)
  assert.deepEqual(rgba(img, 15), [0x10, 0x20, 0x30, 255]);
});

test('touch: texture coordinates to panel pixels, through the area and the turn', () => {
  const flat = { panel: { width: 160, height: 128 }, rotateCW: 0, area: { x: 0, y: 0, width: 1, height: 1 } };
  assert.deepEqual(uvToPanel(flat, [0.5, 0.25]), { x: 80, y: 32 });
  // Brufik-like: panel 240×284 shown turned 90°: the view's top-left is the panel's bottom-left pixel.
  const turned = { panel: { width: 240, height: 284 }, rotateCW: 90, area: { x: 0, y: 0, width: 1, height: 1 } };
  assert.deepEqual(uvToPanel(turned, [0, 0]), { x: 0, y: 283 });
  assert.deepEqual(uvToPanel(turned, [0.999, 0]), { x: 0, y: 0 });
  const framed = { ...flat, area: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } };
  assert.equal(uvToPanel(framed, [0.05, 0.5]), null);
  assert.deepEqual(uvToPanel(framed, [0.1, 0.2]), { x: 0, y: 0 });
});

test('screen image: the turned picture mirrored left-right (flipX) and top-bottom (flipY)', () => {
  // Panel 2×2: red green / blue white. flipX swaps the columns, flipY the rows, both = turned half a turn.
  const W = 0xffff;
  const G = 0x07e0;
  const frame = { width: 2, height: 2, pixels: Uint16Array.from([RED, G, BLUE, W]) };
  const colours = (screen) => {
    const img = createScreenImage({ panel: { width: 2, height: 2, format: 'rgb565' }, rotateCW: 0, area: { x: 0, y: 0, width: 1, height: 1 }, ...screen });
    img.update(frame);
    return [0, 1, 2, 3].map((i) => rgba(img, i).slice(0, 3).join(','));
  };
  const r = '255,0,0'; const g = '0,255,0'; const b = '0,0,255'; const w = '255,255,255';
  assert.deepEqual(colours({}), [r, g, b, w]);
  assert.deepEqual(colours({ flipX: true }), [g, r, w, b]);
  assert.deepEqual(colours({ flipY: true }), [b, w, r, g]);
  assert.deepEqual(colours({ flipX: true, flipY: true }), [w, b, g, r]);
  // mirrored after turning: panel 2×1 red|blue turned 90° stands red over blue; flipY puts blue on top
  const img = createScreenImage({ panel: { width: 2, height: 1, format: 'rgb565' }, rotateCW: 90, flipY: true, area: { x: 0, y: 0, width: 1, height: 1 } });
  img.update({ width: 2, height: 1, pixels: Uint16Array.from([RED, BLUE]) });
  assert.deepEqual(rgba(img, 0), [0, 0, 255, 255]);
});

test('touch on a mirrored screen lands on the pixel shown there', () => {
  const flat = { panel: { width: 160, height: 128 }, rotateCW: 0, area: { x: 0, y: 0, width: 1, height: 1 } };
  assert.deepEqual(uvToPanel({ ...flat, flipX: true }, [0.5, 0.25]), { x: 79, y: 32 });
  assert.deepEqual(uvToPanel({ ...flat, flipY: true }, [0, 0]), { x: 0, y: 127 });
  // Brufik: panel 240×284 turned 270° and mirrored top-bottom; the face's top-left (u 0, v 1 in its upward-running UVs)
  // shows the picture's top-left = the panel's top-right pixel
  const brufik = { panel: { width: 240, height: 284 }, rotateCW: 270, flipY: true, area: { x: 0, y: 0, width: 1, height: 1 } };
  assert.deepEqual(uvToPanel(brufik, [0, 0.9999]), { x: 239, y: 0 });
  assert.deepEqual(uvToPanel(brufik, [0, 0]), { x: 0, y: 0 });
});

test('servo joint angle: zero, direction, scale and limits', () => {
  const s = { zeroDeg: 90, direction: 1, scale: 1 };
  assert.equal(servoJointAngle(s, 90), 0);
  assert.equal(servoJointAngle(s, 150), 60);
  assert.equal(servoJointAngle({ zeroDeg: 90, direction: -1, scale: 0.42 }, 160), -29.4);
  assert.equal(servoJointAngle({ ...s, minDeg: -20, maxDeg: 20 }, 150), 20);
});

test('joystick: a point on the cap relative to its centre, along right and up, clamped to the radius', () => {
  const j = { right: [1, 0, 0], up: [0, 0, -1], radiusMm: 5 };
  assert.deepEqual(joystickFromPoint(j, [2.5, 3, 0], [0, 3, 0]), { x: 0.5, y: 0 });
  assert.deepEqual(joystickFromPoint(j, [0, 3, -10], [0, 3, 0]), { x: 0, y: 1 });
});
