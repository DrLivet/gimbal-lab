// Decodes DJI DUML commands from an Android Bluetooth HCI snoop log (btsnoop_hci.log).
// Use: node tools/btsnoop_duml.mjs <btsnoop_hci.log> [--all]
// Prints each DUML frame the app wrote (->) or the gimbal sent (<-), with time, cmdSet/cmd and
// payload. Without --all, hides the frames that repeat all the time (attitude, heartbeats) so the
// rare ones — button presses, mode switches — stand out.
import fs from 'node:fs';
import { Parser } from '../lib/duml.js';

const file = process.argv[2];
const all = process.argv.includes('--all');
const buf = fs.readFileSync(file);
if (buf.toString('latin1', 0, 8) !== 'btsnoop\0') throw new Error('not a btsnoop file');

const hex = (b) => Buffer.from(b).toString('hex');
const parsers = { '->': new Parser(), '<-': new Parser() };
const frames = [];
const l2cap = new Map(); // handle -> {need, parts} for fragmented ACL packets

let off = 16;
while (off + 24 <= buf.length) {
  const incl = buf.readUInt32BE(off + 4); const flags = buf.readUInt32BE(off + 8);
  const ts = buf.readBigUInt64BE(off + 16);
  const pkt = buf.subarray(off + 24, off + 24 + incl); off += 24 + incl;
  if (pkt[0] !== 0x02) continue;                       // H4 ACL data only
  const dir = flags & 1 ? '<-' : '->';                 // bit0: 1 = received from controller
  const hdl = pkt.readUInt16LE(1); const handle = hdl & 0x0fff; const pb = (hdl >> 12) & 3;
  let data = pkt.subarray(5);
  const key = `${handle}${dir}`;
  if (pb === 1) {                                      // continuation fragment
    const st = l2cap.get(key); if (!st) continue;
    st.parts.push(data); const got = Buffer.concat(st.parts);
    if (got.length < st.need) continue;
    l2cap.delete(key); data = got;
  } else {
    const len = data.readUInt16LE(0);
    if (data.length - 4 < len) { l2cap.set(key, { need: len + 4, parts: [data] }); continue; }
  }
  const cid = data.readUInt16LE(2); if (cid !== 0x0004) continue;   // ATT only
  const att = data.subarray(4); const op = att[0];
  // 0x52 write cmd, 0x12 write req, 0x1b notification, 0x1d indication
  if (![0x52, 0x12, 0x1b, 0x1d].includes(op)) continue;
  const value = att.subarray(3);
  const ms = Number((ts - 0x00dcddb30f2f8000n) / 1000n);   // btsnoop epoch → unix ms
  for (const m of parsers[dir].feed(value)) frames.push({ ms, dir, handle, m });
}

const key = (f) => `${f.dir} ${f.m.cmdSet.toString(16)}/${f.m.cmd.toString(16)}`;
const counts = {};
for (const f of frames) counts[key(f)] = (counts[key(f)] || 0) + 1;
const t0 = frames[0]?.ms ?? 0;
console.log('frame types:', JSON.stringify(counts));
for (const f of frames) {
  if (!all && counts[key(f)] > 40) continue;
  const t = new Date(f.ms).toISOString().slice(11, 23);
  console.log(`${t} +${((f.ms - t0) / 1000).toFixed(1).padStart(6)}s ${f.dir} ${f.m.src?.toString(16) ?? '?'}>${f.m.dst?.toString(16) ?? '?'} ${f.m.cmdSet.toString(16).padStart(2, '0')}/${f.m.cmd.toString(16).padStart(2, '0')} attr ${f.m.attr?.toString(16) ?? '?'}  ${hex(f.m.payload)}`);
}
