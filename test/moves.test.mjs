// Run: node test/moves.test.mjs
import assert from 'node:assert/strict';
import { plan, PRESETS } from '../src/moves.js';

// Deltas add up to the final point and no leg exceeds the gimbal's 25.5 s limit.
for (const p of PRESETS) {
  const steps = plan(p.points);
  const end = steps.reduce((a, s) => ({ pan: a.pan + s.pan, tilt: a.tilt + s.tilt }), { pan: 0, tilt: 0 });
  const last = p.points.at(-1);
  assert.ok(Math.abs(end.pan - last.pan) < 1e-9 && Math.abs(end.tilt - last.tilt) < 1e-9, p.name);
  assert.ok(steps.every((s) => s.secs <= 25.5), `${p.name} has a leg over 25.5 s`);
}
// A 120 s leg is split into 5 legs of 24 s.
const t = plan([{ pan: 60, tilt: 0, secs: 120 }]);
assert.equal(t.length, 5);
assert.equal(t[0].secs, 24);
assert.equal(t[0].pan, 12);
console.log('moves: all tests passed');
