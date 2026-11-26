// Direction check: picture-shift maths and the ok/flip decision, using synthetic images.
import assert from 'node:assert/strict';
import { profiles, bestShift, decide } from '../src/calibrate.js';

// A textured 96x64 scene, sampled with an offset (camera turned) of (ox, oy) pixels.
const scene = (x, y) => 128 + 60 * Math.sin(x * 0.37) * Math.cos(y * 0.21) + 40 * Math.sin((x + 2 * y) * 0.11);
const img = (ox, oy, W = 96, H = 64) => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = scene(x + ox, y + oy); const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return profiles(d, W, H);
};

// Camera turns right by 8 px → content slides left by 8.
let r = bestShift(img(0, 0).col, img(8, 0).col, 30);
assert.equal(r.shift, -8); assert.ok(r.contrast > 0.5);
// Camera tilts up (view moves to smaller y) → content slides down.
r = bestShift(img(0, 0).row, img(0, -6).row, 20);
assert.equal(r.shift, 6);

// Decisions, using what the owner's OM 5 really did on 2026-11-26:
// pan +20 → picture moved left 25: already right.
assert.equal(decide('pan', 1, { shift: -25, contrast: 0.8 }), 'ok');
// tilt "up" (+20) → picture moved up 30: reversed.
assert.equal(decide('tilt', 1, { shift: -30, contrast: 0.8 }), 'flip');
// tilt "down" (-20) → picture moved down 18: reversed (same answer from the other side).
assert.equal(decide('tilt', -1, { shift: 18, contrast: 0.8 }), 'flip');
// pan -20 with picture moving right: ok.
assert.equal(decide('pan', -1, { shift: 12, contrast: 0.8 }), 'ok');
// Too small a move (end stop) or a blank wall → can't tell.
assert.equal(decide('tilt', 1, { shift: 1, contrast: 0.8 }), null);
assert.equal(decide('pan', 1, { shift: -20, contrast: 0.05 }), null);
// Blank wall gives low contrast.
const flat = profiles(new Uint8ClampedArray(96 * 64 * 4).fill(200), 96, 64);
assert.ok(bestShift(flat.col, flat.col, 30).contrast < 0.2);
console.log('calibrate: all tests passed');
