// Turns the BTSNOOP_LOG_SUMMARY block from `adb shell dumpsys bluetooth_manager` into a normal
// btsnoop_hci.log (readable by tools/btsnoop_duml.mjs and Wireshark). Same idea as AOSP btsnooz.py.
// Use: adb shell dumpsys bluetooth_manager > dump.txt; node tools/btsnooz.mjs dump.txt out.log
import fs from 'node:fs';
import zlib from 'node:zlib';

const [inFile, outFile] = process.argv.slice(2);
const text = fs.readFileSync(inFile, 'utf8');
const m = text.match(/--- BEGIN:BTSNOOP_LOG_SUMMARY[^\n]*\n([\s\S]*?)--- END:BTSNOOP_LOG_SUMMARY/);
if (!m) throw new Error('no BTSNOOP_LOG_SUMMARY in dump');
const raw = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
const version = raw[0];
const last = raw.readBigUInt64LE(1) / 1000n;       // newest packet; stored in µs → ms
const data = zlib.inflateSync(raw.subarray(9));

// Records (v1: len u16, delta u32, type u8 / v2: len u16, pktLen u16, delta u32, type u8).
const hdr = version === 1 ? 7 : 9;
const recs = [];
for (let o = 0; o + hdr <= data.length;) {
  const len = data.readUInt16LE(o);
  const delta = version === 1 ? data.readUInt32LE(o + 2) : data.readUInt32LE(o + 4);
  const type = data[o + hdr - 1];
  const body = data.subarray(o + hdr, o + hdr + len - 1);
  recs.push({ delta, type, body }); o += hdr + len - 1;
}
// Deltas are from the previous packet; walk back from the newest timestamp.
let t = last; const times = new Array(recs.length);
for (let i = recs.length - 1; i >= 0; i--) { times[i] = t; t -= BigInt(recs[i].delta); }  // deltas in ms

// type: 0x10 in evt, 0x11 in acl, 0x12 in sco, 0x20 out cmd, 0x21 out acl, 0x22 out sco (+0x13/0x23 iso)
const h4 = { 0x10: 4, 0x11: 2, 0x12: 3, 0x13: 5, 0x20: 1, 0x21: 2, 0x22: 3, 0x23: 5 };
const head = Buffer.alloc(16); head.write('btsnoop\0', 0, 'latin1'); head.writeUInt32BE(1, 8); head.writeUInt32BE(1002, 12);
const parts = [head];
for (let i = 0; i < recs.length; i++) {
  const r = recs[i]; if (!(r.type in h4)) continue;
  const incoming = (r.type & 0xf0) === 0x10;
  const pkt = Buffer.concat([Buffer.from([h4[r.type]]), r.body]);
  const rh = Buffer.alloc(24);
  rh.writeUInt32BE(pkt.length, 0); rh.writeUInt32BE(pkt.length, 4);
  rh.writeUInt32BE((incoming ? 1 : 0) | (r.type === 0x10 || r.type === 0x20 ? 2 : 0), 8);
  rh.writeUInt32BE(0, 12);
  rh.writeBigUInt64BE(times[i] * 1000n + 0x00dcddb30f2f8000n, 16);  // unix ms → btsnoop µs epoch
  parts.push(rh, pkt);
}
fs.writeFileSync(outFile, Buffer.concat(parts));
console.log(`btsnooz v${version}: ${recs.length} packets, ${new Date(Number(times[0])).toISOString()} → ${new Date(Number(last)).toISOString()}`);
