// Run: node test/follow.test.mjs
import assert from 'node:assert/strict';
import { Follow, pickTarget, facingScore, WALKING, fovFor } from '../src/follow.js';

const face = (x, y, w = 0.15) => ({ x, y, w, h: w });
const run = (f, t, secs, dt = 1 / 15) => { let v; for (let i = 0; i < secs / dt; i++) v = f.update(t, dt); return v; };

// Person centred: no motion.
let f = new Follow();
let v = run(f, face(0.5, 0.48), 2);
assert.equal(v.pan, 0); assert.equal(v.tilt, 0);

// Person to the right: pan right (positive), and speed grows smoothly rather than jumping.
f = new Follow();
// (Face held fixed in the picture, so this only checks the first half second.)
const first = f.update(face(0.8, 0.48), 1 / 15);
let peak = 0; for (let i = 0; i < 7; i++) peak = Math.max(peak, f.update(face(0.8, 0.48), 1 / 15).pan);
assert.ok(peak > 10, `expected strong right pan, got ${peak}`);
assert.ok(first.pan < peak, 'should ramp up');
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

// Lost at the right edge: sweep right to find them, then stop after the search time.
f = new Follow();
run(f, face(0.9, 0.48), 1);
v = run(f, null, 0.6);
assert.ok(v.pan > 20, `searches toward where they left (${v.pan})`);
v = run(f, null, 3);
assert.equal(v.pan, 0);
// Lost from the middle (e.g. turned away): just stop.
f = new Follow();
run(f, face(0.5, 0.48), 1);
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

// Real-world delay (Bluetooth + camera + detector ≈ 0.3–0.5 s, measured on the owner's OM 5):
// with the defaults, the face settles in the middle within ~1.5 s without swinging past it.
{
  const sim = (cmdDelay, seeDelay = 0.12, dt = 1 / 15) => {
    const f = new Follow({ hfov: 66 }); let yaw = 0; const yawH = []; const cmdH = []; const xs = [];
    for (let i = 0; i < 6 / dt; i++) {
      const t = i * dt; yawH.push([t, yaw]);
      const seen = yawH.filter(([tt]) => tt <= t - seeDelay).at(-1)?.[1] ?? 0;
      const v = f.update(face(0.5 + (15 - seen) / 66, 0.435), dt); cmdH.push([t, v.pan]);
      yaw += (cmdH.filter(([tt]) => tt <= t - cmdDelay).at(-1)?.[1] ?? 0) * dt; xs.push(0.5 + (15 - yaw) / 66);
    }
    return { over: Math.max(...xs.map((x) => 0.5 - x)), settle: xs.findIndex((x, i) => xs.slice(i).every((y) => Math.abs(y - 0.5) < 0.08)) * dt };
  };
  for (const d of [0.2, 0.35]) {
    const r = sim(d);
    assert.ok(r.over < 0.05, `no swing past the middle (delay ${d}s: ${r.over.toFixed(3)})`);
    assert.ok(r.settle >= 0 && r.settle < 1.6, `settles quickly (delay ${d}s: ${r.settle.toFixed(2)}s)`);
  }
}
console.log('follow: delay simulation passed');

// Room simulation like the owner's OM 5: phone upright, gimbal turns ~80% of what it's told,
// 0.3 s command delay, picture 0.12 s old, detector wobble.
{
  const run = (path, { secs = 6, noise = 0.008 } = {}) => {
    const fov = fovFor(1080, 1920); const dt = 1 / 15; const f = new Follow({ ...fov });
    const cam = { pan: 0, tilt: 0 }; const H = []; const C = []; const log = [];
    let r = 7; const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let i = 0; i < secs / dt; i++) {
      const t = i * dt; H.push([t, { ...cam }]);
      const seen = H.filter(([tt]) => tt <= t - 0.12).at(-1)?.[1] ?? { pan: 0, tilt: 0 };
      const p = path(t - 0.12);
      const x = 0.5 + (p.pan - seen.pan) / fov.hfov + noise * rand(); const y = 0.42 - (p.tilt - seen.tilt) / fov.vfov + noise * rand();
      const v = f.update(Math.abs(x - 0.5) < 0.5 && Math.abs(y - 0.5) < 0.5 ? face(x, y + 0.015) : null, dt); C.push([t, v]);
      const ap = C.filter(([tt]) => tt <= t - 0.3).at(-1)?.[1] ?? { pan: 0, tilt: 0 };
      cam.pan += ap.pan * 0.8 * dt; cam.tilt += ap.tilt * 0.8 * dt;
      const q = path(t); log.push({ t, x: 0.5 + (q.pan - cam.pan) / fov.hfov, y: 0.42 - (q.tilt - cam.tilt) / fov.vfov, v });
    }
    return log;
  };
  const out = (L) => L.filter((l) => Math.abs(l.x - 0.5) > 0.5 || Math.abs(l.y - 0.5) > 0.5).length;
  // Sitting still with wobble: after settling, the gimbal doesn't move at all.
  const still = run(() => ({ pan: 4, tilt: 0 }), { noise: 0.015 }).filter((l) => l.t > 2);
  assert.equal(still.filter((l) => Math.abs(l.v.pan) > 0.3 || Math.abs(l.v.tilt) > 0.3).length, 0, 'holds still when you sit still');
  // Walk-and-talk at 20°/s for 4 s: never leaves the picture.
  assert.equal(out(run((t) => ({ pan: Math.min(Math.max(t - 0.5, 0), 4) * 20, tilt: 0 }), { secs: 7 })), 0, 'keeps up with a walk');
  // A very fast 60°/s move: slips out, then the search sweep finds you and re-centres.
  const fast = run((t) => ({ pan: Math.min(Math.max(t - 0.5, 0), 1.5) * 60, tilt: 0 }), { secs: 8 });
  assert.ok(Math.abs(fast.at(-1).x - 0.5) < 0.08, `re-finds you after a fast move (${fast.at(-1).x.toFixed(2)})`);
  // Standing up (20° up) and sitting down: tilt follows.
  for (const dir of [1, -1]) {
    const L = run((t) => ({ pan: 0, tilt: dir * Math.min(Math.max(t - 0.5, 0), 1) * 20 }));
    assert.equal(out(L), 0); assert.ok(Math.abs(L.at(-1).y - 0.42) < 0.07, `tilt follows (${dir > 0 ? 'up' : 'down'}: ${L.at(-1).y.toFixed(2)})`);
  }
}
// Never swings back and forth, even if the gimbal turns 0.5–1.6× as fast as asked
// or answers up to 0.5 s late (the swinging the owner saw on 2026-11-26).
{
  const sim = (eff, delay) => {
    const fov = fovFor(1920, 1080); const dt = 1 / 15; const f = new Follow({ ...fov });
    let cam = 0; const H = []; const C = []; const v = [];
    for (let i = 0; i < 8 / dt; i++) {
      const t = i * dt; H.push([t, cam]);
      const seen = H.filter(([tt]) => tt <= t - 0.12).at(-1)?.[1] ?? 0;
      const o = f.update(face(0.5 + (15 - seen) / fov.hfov, 0.435), dt); C.push([t, o.pan]); v.push(o.pan);
      cam += (C.filter(([tt]) => tt <= t - delay).at(-1)?.[1] ?? 0) * eff * dt;
    }
    return v.slice(1).filter((x, i) => x && v[i] && Math.sign(x) !== Math.sign(v[i])).length;
  };
  for (const eff of [0.5, 0.8, 1.2, 1.6]) for (const d of [0.2, 0.35, 0.5]) assert.ok(sim(eff, d) <= 2, `no swinging (speed ×${eff}, delay ${d}s: ${sim(eff, d)} reversals)`);
}
console.log('follow: room simulation passed');
