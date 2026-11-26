// node test/mic.test.mjs — pure parts of src/mic.js
import assert from 'node:assert/strict';
import { isSilent, orderInputs } from '../src/mic.js';
assert.equal(isSilent(new Float32Array(2048)), true, 'all zeros = dead mic');
const noise = new Float32Array(2048).map(() => (Math.random() - 0.5) * 1e-4);
assert.equal(isSilent(noise), false, 'room noise = live mic');
const ins = [{ deviceId: 'h', label: 'Headset earpiece' }, { deviceId: 's', label: 'Speakerphone' }, { deviceId: 'default', label: 'Default' }];
assert.deepEqual(orderInputs(ins, 'auto').map((d) => d.deviceId), ['s', 'default', 'h'], 'speakerphone before Default');
assert.deepEqual(orderInputs(ins, 'h').map((d) => d.deviceId), ['h', 's', 'default'], 'user choice first');
console.log('mic: all tests passed');
