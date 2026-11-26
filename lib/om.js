// DJI Osmo Mobile (OM 4 and relatives) driver + the "wake-up" test ladder.
import { build, rotatePayload, ROT, Parser, describe, hex, ATTR_REQ } from './duml.js';
import { pickDevice, writeChunks, serial } from './ble.js';

const SVC = '0000fff0-0000-1000-8000-00805f9b34fb';
const NOTIFY = '0000fff4-0000-1000-8000-00805f9b34fb';
const WRITE = '0000fff5-0000-1000-8000-00805f9b34fb';

export class OsmoMobile extends EventTarget {
  constructor() {
    super();
    this.parser = new Parser();
    this.seq = 1;
    this.queue = serial();
    this.heartbeats = new Set(); // names of heartbeat kinds currently running
    this.timer = null;
    this.att = null; // latest attitude
    this.pan = null; // latest pan motor angle (bytes 8-9, per OM 4 SE notes)
    this.rxCount = 0;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect(namePrefix, device) {
    this.device = device || await pickDevice({ namePrefix });
    this.device.addEventListener('gattserverdisconnected', () => { this.stopHeartbeat(); this.emit('disconnected'); });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SVC);
    this.rx = await svc.getCharacteristic(NOTIFY);
    this.tx = await svc.getCharacteristic(WRITE);
    this.rx.addEventListener('characteristicvaluechanged', (e) => this.onData(new Uint8Array(e.target.value.buffer)));
    await this.rx.startNotifications();
    this.emit('connected', { name: this.device.name });
  }

  disconnect() { this.stopHeartbeat(); this.device?.gatt?.connected && this.device.gatt.disconnect(); }

  onData(chunk) {
    for (const m of this.parser.feed(chunk)) {
      this.rxCount++;
      const d = describe(m);
      if (d.kind === 'attitude') {
        this.att = { pitch: d.pitch, roll: d.roll, yaw: d.yaw, t: performance.now() };
        const p = m.payload;
        if (p.length >= 10) { const v = p[8] | (p[9] << 8); this.pan = (v & 0x8000 ? v - 0x10000 : v) / 10; }
      }
      if (d.kind === 'battery') this.battery = d.level;
      this.emit('packet', { m, d });
    }
  }

  // Low-level send. opts: { attr, seq } override the defaults.
  send(cmdSet, cmd, payload = [], opts = {}) {
    const seq = opts.seq ?? this.seq++;
    if (this.seq > 0xffff) this.seq = 1;
    const pkt = build({ seq, attr: opts.attr ?? ATTR_REQ, cmdSet, cmd, payload });
    return this.queue(async () => {
      await writeChunks(this.tx, pkt);
      this.emit('sent', { pkt, cmdSet, cmd, quiet: opts.quiet });
    });
  }

  rotate({ yaw = 0, pitch = 0, roll = 0, time = 1, mode = ROT.RELATIVE }, opts) {
    const cmd = mode === ROT.SPEED ? 0x0c : 0x14;
    return this.send(0x04, cmd, rotatePayload({ yaw, pitch, roll, time, mode }), opts);
  }

  // Heartbeats Mimo sends continuously. Kinds: 'status' (04/50 01 04 05), 'ping' (00/00 02 00).
  startHeartbeat(kind) {
    this.heartbeats.add(kind);
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.heartbeats.has('status')) this.send(0x04, 0x50, [0x01, 0x04, 0x05], { quiet: true }).catch(() => {});
      if (this.heartbeats.has('ping')) this.send(0x00, 0x00, [0x02, 0x00], { quiet: true }).catch(() => {});
    }, 1000);
  }

  stopHeartbeat() { this.heartbeats.clear(); clearInterval(this.timer); this.timer = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each step adds something Mimo is known to send. Steps are cumulative (heartbeats keep running),
// so the first step that moves the gimbal tells us what the OM 4 is waiting for.
export const LADDER = [
  { id: 'demo', title: 'Same as the om-research demo', note: 'sequence fixed at 1, no "wants reply" flag',
    run: (g, dir) => g.rotate({ yaw: 25 * dir }, { seq: 1, attr: 0x00 }) },
  { id: 'mimo-framing', title: 'Mimo-style framing', note: 'counting sequence + "wants reply" flag',
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'heartbeat', title: '+ status heartbeat every second', note: 'Mimo sends 04/50 continuously',
    prep: (g) => g.startHeartbeat('status'), wait: 2500,
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'ping', title: '+ ping heartbeat', note: 'Mimo also sends 00/00 02 00',
    prep: (g) => g.startHeartbeat('ping'), wait: 2500,
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'enable', title: '+ "motion control on" (04/01)', note: 'SDK: set_motion_control',
    prep: (g) => g.send(0x04, 0x01, [0x01]), wait: 600,
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'stick', title: '+ "stick control on" (04/58)', note: 'SDK: set_stick_control_enable',
    prep: (g) => g.send(0x04, 0x58, [0x01]), wait: 600,
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'feature', title: '+ feature control (04/54)', note: 'needed for Mimo timelapse',
    prep: (g) => g.send(0x04, 0x54, [0x01, 0xb0, 0x04, 0, 0, 0, 0, 0x80, 0, 0, 0]), wait: 600,
    run: (g, dir) => g.rotate({ yaw: 25 * dir }) },
  { id: 'absolute', title: 'Absolute move, exactly as captured from Mimo', note: 'yaw ±45°, 1.5 s',
    run: (g, dir) => g.send(0x04, 0x14, [...(dir > 0 ? [0xc2, 0x01] : [0x3e, 0xfe]), 0, 0, 0x20, 0x00, 0x05, 0x0f]) },
  { id: 'speed', title: 'Speed mode (turn at 30°/s for 1 s)', note: 'command 04/0c',
    run: async (g, dir) => { g.rotate({ yaw: 30 * dir, mode: ROT.SPEED, time: 0 });
      await sleep(1000); return g.rotate({ yaw: 0, mode: ROT.SPEED, time: 0 }); } },
];

// Runs one step: prep, move one way, watch attitude, move back. Returns {moved, delta, haveAttitude}.
export async function runStep(g, step) {
  if (step.prep) { await step.prep(g); await sleep(step.wait ?? 500); }
  const before = snapshot(g);
  await step.run(g, +1);
  await sleep(2200);
  const after = snapshot(g);
  await step.run(g, -1); // undo
  await sleep(1800);
  const haveAttitude = before && after && after.t > before.t;
  let delta = 0;
  if (haveAttitude) delta = Math.max(...['yaw', 'pitch', 'pan'].map((k) =>
    before[k] == null || after[k] == null ? 0 : Math.abs(angDiff(after[k], before[k]))));
  return { moved: haveAttitude ? delta > 4 : null, delta, haveAttitude };
}

function snapshot(g) { return g.att ? { ...g.att, pan: g.pan } : null; }
function angDiff(a, b) { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

export { hex };
