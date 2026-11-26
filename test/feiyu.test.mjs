// Feiyu AK protocol: packets must match the Feiyu app's own builder byte for byte.
// Expected values were produced by compiling the app's AkCmdWriter.generateWholeCmd and
// MathUtils.calcCRC_CCITT_XModem logic in Java (see lib/feiyu.js header).
import assert from 'node:assert/strict';
import { crc16xmodem, joystickPacket, recenterPacket, followModePacket, AkParser, FOLLOW_MODE } from '../lib/feiyu.js';

const hex = (b) => Buffer.from(b).toString('hex');

// Standard CRC-16/XMODEM check value.
assert.equal(crc16xmodem(new TextEncoder().encode('123456789')), 0x31c3);

assert.equal(hex(joystickPacket(0, 0)), 'a55a03000e000005000000000000cc45');
assert.equal(hex(joystickPacket(450, 0)), 'a55a03000e0000050000c2010000302c');
assert.equal(hex(joystickPacket(-450, -200)), 'a55a03000e00000500003efe38ffe0a1');
assert.equal(hex(joystickPacket(9999, 0)), hex(joystickPacket(450, 0)), 'clamps to full scale');
assert.equal(hex(recenterPacket()), 'a55a03023320000100023c56');
assert.equal(hex(followModePacket(FOLLOW_MODE.PAN_FOLLOW)), 'a55a0302322000010001ff23');

// Parser: split, resync after junk, and verify CRC.
const p = new AkParser();
const a = joystickPacket(450, 0), b = recenterPacket();
const stream = [0x00, 0x13, ...a, ...b];
let got = p.push(stream.slice(0, 10));
got = got.concat(p.push(stream.slice(10)));
assert.equal(got.length, 2);
assert.equal(got[0].cmdId, 14);
assert.equal(got[0].cmdType, 0);
assert.ok(got[0].crcOk);
assert.equal(got[1].cmdId, 51);
assert.equal(got[1].cmdType, 1);
assert.deepEqual([...got[1].data], [2]);
const bad = Uint8Array.from(b); bad[bad.length - 1] ^= 0xff;
assert.equal(new AkParser().push(bad)[0].crcOk, false);

console.log('feiyu: ok');
