// Run: node test/duml.test.mjs
import assert from 'node:assert/strict';
import { build, rotatePayload, ROT, Parser, crc16, hex } from '../duml.js';

// Packets copied from the log of the original om-research demo talking to our OM 4.
// (CRC bytes are omitted: they were too small to read reliably in the phone screenshot.)
const fromLog = ['55 15 04 a9 02 04 01 00 00 04 14 3e fe 00 00 00 00 04 0a']; // yaw -45, 1.0s
const bytes = (s) => Uint8Array.from(s.split(' ').map((x) => parseInt(x, 16)));

// 1. Our builder reproduces the exact packet the demo sent.
const a = build({ seq: 1, attr: 0x00, cmdSet: 0x04, cmd: 0x14,
  payload: rotatePayload({ yaw: -45, mode: ROT.RELATIVE, time: 1 }) });
assert.equal(hex(a.slice(0, -2)), fromLog[0]);

// 2. Whole-packet crc (seed 0x3692) == body crc (seed 0xdf0c) used by the demo.
const p = a;
assert.equal(crc16(p.slice(0, -2)), crc16(p.slice(4, -2), 0xdf0c));

// 3. Parser round-trips, including split across BLE chunks, and validates CRCs.
const b = build({ seq: 0x47, cmdSet: 0x04, cmd: 0x14, payload: rotatePayload({ yaw: 45 }) });
const parser = new Parser();
assert.deepEqual(parser.feed(b.slice(0, 7)), []);
const [m] = parser.feed([...b.slice(7), 0x00]);
assert.equal(m.crcOk, true);
assert.equal(m.seq, 0x47);
assert.equal(m.cmd, 0x14);

// 4. Packets captured from Mimo (listed in om-research's CRC notes) validate with our CRC.
for (const s of ['02 04 47 00 40 04 14 c2 01 00 00 20 00 05 0f eb 63',
                 '02 04 5e 00 40 04 14 3e fe 00 00 20 00 05 0f a2 e7',
                 '02 04 73 00 40 04 14 c2 01 00 00 20 00 05 0f 2f 9a']) {
  const q = bytes(s);
  assert.equal(crc16(q.slice(0, -2), 0xdf0c), q.at(-2) | (q.at(-1) << 8), s);
}
// (legacy single check kept below)
// 4b. The Mimo-captured body from om-research's CRC notes matches our framing.
const mimo = bytes('02 04 47 00 40 04 14 c2 01 00 00 20 00 05 0f eb 63');
assert.equal(crc16(mimo.slice(0, -2), 0xdf0c), mimo.at(-2) | (mimo.at(-1) << 8));

console.log('duml: all tests passed');
