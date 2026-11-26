// Sony Bluetooth remote: command bytes and status parsing (freemote protocol).
import assert from 'node:assert/strict';
import { CODES, bytes, parseStatus, SERVICE } from '../lib/sony.js';

assert.equal(SERVICE, '8000ff00-ff00-ffff-ffff-ffffffffffff');
assert.deepEqual([...bytes(CODES.record[0])], [0x01, 0x0f], 'record press');
assert.deepEqual([...bytes(CODES.record[1])], [0x01, 0x0e], 'record release');
assert.deepEqual([...bytes(CODES.shutterFull[0])], [0x01, 0x09]);
assert.deepEqual(parseStatus(Uint8Array.of(0x02, 0xd5, 0x20)), { kind: 'recording', on: true });
assert.deepEqual(parseStatus(Uint8Array.of(0x02, 0xd5, 0x00)), { kind: 'recording', on: false });
assert.deepEqual(parseStatus(Uint8Array.of(0x02, 0x3f, 0x20)), { kind: 'focus', on: true });
assert.equal(parseStatus(Uint8Array.of(0x01)), null);
console.log('sony: all tests passed');
