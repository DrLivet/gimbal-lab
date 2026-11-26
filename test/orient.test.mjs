// Portrait/landscape maths: phone angle from gravity, where to go, how fast.
import assert from 'node:assert/strict';
import { phoneAngle, targetFor, rollSpeed } from '../src/orient.js';
import { parseCommand } from '../src/voice.js';

const near = (a, b) => Math.abs(a - b) < 0.5;
assert.ok(near(phoneAngle(0, 9.8), 0), 'upright = 0');
assert.ok(near(phoneAngle(9.8, 0), 90), 'on its side = 90');
assert.ok(near(phoneAngle(-9.8, 0), -90));
// Measured on the OM 5: gravity x 3.6, y 10.3 → leaning about 19°.
assert.ok(near(phoneAngle(3.6, 10.3), 19.3));

assert.equal(targetFor(1), 90);     // portrait → landscape
assert.equal(targetFor(-10), -90);  // leaning the other way → that side
assert.equal(targetFor(88), 0);     // landscape → portrait
assert.equal(targetFor(-85), 0);

assert.equal(rollSpeed(89, 90), 0, 'close enough: stop');
assert.equal(rollSpeed(0, 90), 60, 'far: full speed');
assert.ok(rollSpeed(85, 90) >= 6 && rollSpeed(85, 90) <= 10, 'near the end: slow');
assert.ok(rollSpeed(80, 0) < 0, 'back toward upright: negative');

for (const [said, cmd] of [['landscape', 'orient-landscape'], ['go landscape', 'orient-landscape'], ['portrait', 'orient-portrait'],
  ['rotate the phone', 'orient-toggle'], ['flip', 'orient-toggle'], ['stop recording', 'record-stop'], ['follow me', 'follow-on']]) {
  assert.equal(parseCommand(said)?.cmd, cmd, said);
}
console.log('orient: all tests passed');
