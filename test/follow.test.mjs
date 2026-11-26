// Run: node test/follow.test.mjs
import assert from 'node:assert/strict';
import { Follow, pickTarget, facingScore, WALKING } from '../src/follow.js';

const face = (x, y, w = 0.15) => ({ x, y, w, h: w });
const run = (f, t, secs, dt = 1 / 15) => { let v; for (let i = 0; i < secs / dt; i++) v = f.update(t, dt); return v; };

// Person centred: no motion.
let f = new Follow();
let v = run(f, face(0.5, 0.48), 2);
assert.equal(v.pan, 0); assert.equal(v.tilt, 0);

// Person to the right: pan right (positive), and speed grows smoothly rather than jumping.
f = new Follow();
const first = f.update(face(0.8, 0.48), 1 / 15);
v = run(f, face(0.8, 0.48), 1);
assert.ok(v.pan > 10, `expected strong right pan, got ${v.pan}`);
assert.ok(first.pan < v.pan, 'should ramp up');
// To the left: pan left.
v = run(new Follow(), face(0.2, 0.48), 1);
assert.ok(v.pan < -10);

// Person high in frame: tilt up (positive). Tilt off: no tilt.
v = run(new Follow(), face(0.5, 0.1), 1);
assert.ok(v.tilt > 5);
v = run(new Follow({ tiltEnabled: false }), face(0.5, 0.1), 1);
assert.equal(v.tilt, 0);

// Small jitter inside the deadzone never moves the gimbal.
f = new Follow();
for (let i = 0; i < 60; i++) v = f.update(face(0.5 + (i % 2 ? 0.03 : -0.03), 0.48), 1 / 15);
assert.equal(v.pan, 0);

// Framing "left": person centred means pan right... no: the person should sit on the left third,
// so a centred person is too far right and the gimbal pans right to put them left.
v = run(new Follow({ framing: 'left' }), face(0.5, 0.48), 1);
assert.ok(v.pan > 5);

// Lost: speed decays to zero after lostAfter.
f = new Follow();
run(f, face(0.9, 0.48), 1);
v = run(f, null, 2);
assert.equal(v.pan, 0);

// Speed is capped.
v = run(new Follow({ maxSpeed: 20, speed: 2 }), face(1, 0.48), 2);
assert.ok(v.pan <= 20.0001);

// pickTarget sticks with the same person, otherwise picks the biggest.
assert.equal(pickTarget([face(0.2, 0.5, 0.1), face(0.7, 0.5, 0.3)], null).x, 0.7);
assert.equal(pickTarget([face(0.2, 0.5, 0.1), face(0.7, 0.5, 0.3)], { x: 0.22, y: 0.5 }).x, 0.2);

// facingScore: straight on is high, turned away is low.
const kp = (noseX) => [{ x: 0.45, y: 0.4 }, { x: 0.55, y: 0.4 }, { x: noseX, y: 0.45 }];
assert.ok(facingScore(kp(0.5)) > 0.95);
assert.ok(facingScore(kp(0.56)) < 0.2);

// Walking mode: a jittery target (body bobbing ±4% each frame) gives a much calmer speed
// than desk mode, and starts more gently.
{
  const jitter = (f) => { const out = []; for (let i = 0; i < 90; i++) out.push(f.update(face(0.7 + (i % 2 ? 0.04 : -0.04), 0.48), 1 / 15).pan); return out; };
  const swing = (a) => { let m = 0; for (let i = 31; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
  const desk = jitter(new Follow()); const walk = jitter(new Follow({ smoothing: WALKING.smoothing, accel: WALKING.accel, lostAfter: WALKING.lostAfter }));
  assert.ok(swing(walk) < swing(desk) * 0.6, `walking is smoother (${swing(walk).toFixed(2)} vs ${swing(desk).toFixed(2)})`);
  assert.ok(Math.abs(walk[5]) < Math.abs(desk[5]), 'walking starts more gently');
  assert.ok(Math.abs(walk.at(-1)) > 5, 'walking still follows');
}

console.log('follow: all tests passed');
