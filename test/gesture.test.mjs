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
