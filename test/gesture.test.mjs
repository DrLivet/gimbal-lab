// Held-hand-sign logic: fires once per deliberate hold, ignores quick flashes and waving.
import assert from 'node:assert/strict';
import { HoldDetector } from '../src/gesture.js';

const run = (d, seq, dt = 1 / 6, t0 = 0) => { const out = []; let t = t0; for (const s of seq) { const f = d.update(s, t); if (f) out.push([f, +t.toFixed(2)]); t += dt; } return { out, t }; };
const rep = (s, n) => Array(n).fill(s);

// Held palm ~1 s fires exactly once, even if kept up for 3 s
let d = new HoldDetector();
let r = run(d, rep('palm', 18));
assert.equal(r.out.length, 1, 'one fire per hold'); assert.equal(r.out[0][0], 'palm');
assert.ok(r.out[0][1] >= 0.9 && r.out[0][1] <= 1.2, `fires after about a second (${r.out[0][1]})`);

// Quick flash (0.3 s) does nothing
d = new HoldDetector(); r = run(d, [...rep('palm', 2), ...rep(null, 10)]);
assert.equal(r.out.length, 0, 'brief palm ignored');

// Hand down then up again fires a second time
d = new HoldDetector(); r = run(d, [...rep('palm', 9), ...rep(null, 6), ...rep('palm', 9)]);
assert.equal(r.out.length, 2, 'second hold after lowering the hand fires again');

// A missed frame or two during the hold still counts
d = new HoldDetector(); r = run(d, ['palm', 'palm', null, 'palm', 'palm', 'palm', null, 'palm', 'palm', 'palm']);
assert.equal(r.out.length, 1, 'tolerates dropouts');

// Peace sign is its own action
d = new HoldDetector(); r = run(d, rep('peace', 8));
assert.deepEqual(r.out.map((x) => x[0]), ['peace']);

// Waving between nothing and palm (half the time) doesn't fire
d = new HoldDetector(); r = run(d, Array.from({ length: 24 }, (_, i) => (i % 2 ? 'palm' : null)));
assert.equal(r.out.length, 0, 'waving ignored');
console.log('gesture: all tests passed');

// Twist (turning a knob) → portrait/landscape
import { TwistDetector, handAngle } from '../src/gesture.js';
{
  const feed = (d, angles, dt = 0.1) => { const out = []; angles.forEach((a, i) => { const f = d.update(a, i * dt); if (f) out.push(+(i * dt).toFixed(1)); }); return out; };
  const ramp = (from, to, n) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  // Fingers up, then twist 90° in 0.8 s: fires once.
  assert.equal(feed(new TwistDetector(), [...ramp(0, 90, 9), ...Array(10).fill(90)]).length, 1, 'knob twist fires');
  // Twist the other way too.
  assert.equal(feed(new TwistDetector(), [...ramp(10, -80, 9), -80, -80, -80, -80]).length, 1);
  // Through ±180 (hand upside down) still counts.
  assert.equal(feed(new TwistDetector(), [...ramp(140, 230, 8), 230, 230, 230, 230].map((a) => (a > 180 ? a - 360 : a))).length, 1);
  // Slow drift of 90° over 4 s: not a twist.
  assert.equal(feed(new TwistDetector(), ramp(0, 90, 40)).length, 0, 'slow drift ignored');
  // Waving back and forth ±40°: not a twist.
  assert.equal(feed(new TwistDetector(), Array.from({ length: 30 }, (_, i) => (i % 4 < 2 ? -40 : 40))).length, 0, 'wave ignored');
  // Small twist (40°): ignored.
  assert.equal(feed(new TwistDetector(), ramp(0, 40, 6)).length, 0);
  // Smooth wave (sweep across and straight back, repeatedly): not a twist.
  const sweep = [...ramp(-40, 40, 4), ...ramp(40, -40, 4)];
  assert.equal(feed(new TwistDetector(), [...sweep, ...sweep, ...sweep]).length, 0, 'smooth wave ignored');
  // Two twists close together: only one (cooldown).
  assert.equal(feed(new TwistDetector(), [...ramp(0, 90, 8), 90, 90, 90, ...ramp(90, 0, 8), 0, 0, 0]).length, 1, 'cooldown');
  // handAngle: wrist below middle knuckle = 0°, hand pointing right = 90°.
  const lm = (dx, dy) => { const a = Array(21).fill({ x: 0.5, y: 0.5 }); a[0] = { x: 0.5, y: 0.5 }; a[9] = { x: 0.5 + dx, y: 0.5 + dy }; return a; };
  assert.ok(Math.abs(handAngle(lm(0, -0.1))) < 1); assert.ok(Math.abs(handAngle(lm(0.1, 0)) - 90) < 1);
  console.log('gesture: twist tests passed');
}
