// Feiyu SCORP-C driver (Feiyu "AK" protocol, protocolType 2).
//
// Decoded from the owner's own copy of the Feiyu SCORP app (v1.5.12, com.feiyutech.feiyuscorp)
// for interoperability with the owner's own gimbal. Sources in the decompiled app:
//   assets/gimbal-ble-properties.json   FY_SCORP_C_xx -> uuidType 1 (service FFFF, write FF01, notify FF02)
//   assets/config/devices/scorp_c.json  protocolType 2, joystick 30 Hz, keep sending zero for 1000 ms
//   lib/gimbal/request/AkCmdWriter      packet layout and joystick payload
//   cn/wandersnail/.../MathUtils        CRC-16/XMODEM (poly 0x1021, init 0)
//   lib/gimbal/protocol/AkProtocol      command ids; constants/UseMode (2 = restore initial position)
//   GimbalControlActivityModel          joystick full scale is +-450 for the AK protocol
//
// Packet (all multi-byte numbers little endian):
//   A5 5A | 03 | target | u16 (cmdType << 13 | cmdId) | msgId | u16 len | data[len] | u16 crc
//   crc = CRC-16/XMODEM over everything after A5 5A, up to the end of data.
import { pickDevice, writeChunks, serial } from './ble.js';

export const SERVICE = 0xffff;
export const WRITE_CHAR = 0xff01;
export const NOTIFY_CHAR = 0xff02;
export const NAME_PREFIX = 'FY_SCORP';

export const CMD_TYPE = { PUSH: 0, SET: 1, GET: 2, RESPONSE_SET: 3, RESPONSE_GET: 4 };
export const CMD = { CONTROL_JOYSTICK: 14, FOLLOW_MODE: 50, USE_MODE: 51, BLUETOOTH_HEARTBEAT: 153 };
export const TARGET = { GIMBAL: 0, GIMBAL_C: 2 };
export const USE_MODE = { DORMANT: 0, REVERSE: 1, RESTORE_INITIAL_POSITION: 2, WAKE_UP: 3 };
export const FOLLOW_MODE = { LOCK: 0, PAN_FOLLOW: 1, PAN_TILT_FOLLOW: 2, THREE_AXIS_FOLLOW: 3 };
export const JOYSTICK_MAX = 450;
export const JOYSTICK_HZ = 30;
export const KEEP_ZERO_MS = 1000;

export function crc16xmodem(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function buildPacket({ target = 0, cmdType = 0, cmdId, msgId = 0, data = [] }) {
  const d = Uint8Array.from(data);
  const out = new Uint8Array(d.length + 11);
  const word = ((cmdType & 0x7) << 13) | (cmdId & 0x1fff);
  out.set([0xa5, 0x5a, 0x03, target & 0xff, word & 0xff, word >> 8, msgId & 0xff, d.length & 0xff, d.length >> 8]);
  out.set(d, 9);
  const crc = crc16xmodem(out.subarray(2, 9 + d.length));
  out[9 + d.length] = crc & 0xff;
  out[10 + d.length] = crc >> 8;
  return out;
}

const i16 = (v) => { const n = Math.round(v) & 0xffff; return [n & 0xff, n >> 8]; };

// pan ("course") and tilt ("pitch") in joystick units, -450..450.
export function joystickPacket(pan, tilt, roll = false) {
  const c = Math.max(-JOYSTICK_MAX, Math.min(JOYSTICK_MAX, pan));
  const p = Math.max(-JOYSTICK_MAX, Math.min(JOYSTICK_MAX, tilt));
  return buildPacket({ target: TARGET.GIMBAL, cmdType: CMD_TYPE.PUSH, cmdId: CMD.CONTROL_JOYSTICK, data: [roll ? 1 : 0, ...i16(c), ...i16(p)] });
}

export const recenterPacket = () =>
  buildPacket({ target: TARGET.GIMBAL_C, cmdType: CMD_TYPE.SET, cmdId: CMD.USE_MODE, data: [USE_MODE.RESTORE_INITIAL_POSITION] });

export const followModePacket = (mode) =>
  buildPacket({ target: TARGET.GIMBAL_C, cmdType: CMD_TYPE.SET, cmdId: CMD.FOLLOW_MODE, data: [mode] });

// Splits a notification stream into whole packets and checks each CRC.
export class AkParser {
  constructor() { this.buf = []; }
  push(bytes) {
    this.buf.push(...bytes);
    const out = [];
    for (;;) {
      const start = this.buf.findIndex((b, i) => b === 0xa5 && this.buf[i + 1] === 0x5a);
      if (start < 0) { this.buf = this.buf.slice(-1); break; }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 11) break;
      const len = this.buf[7] | (this.buf[8] << 8);
      if (len > 1024) { this.buf = this.buf.slice(2); continue; }
      if (this.buf.length < len + 11) break;
      const pkt = Uint8Array.from(this.buf.slice(0, len + 11));
      this.buf = this.buf.slice(len + 11);
      const crc = pkt[9 + len] | (pkt[10 + len] << 8);
      const word = pkt[4] | (pkt[5] << 8);
      out.push({ target: pkt[3], cmdType: word >> 13, cmdId: word & 0x1fff, msgId: pkt[6],
        data: pkt.slice(9, 9 + len), crcOk: crc === crc16xmodem(pkt.subarray(2, 9 + len)), raw: pkt });
    }
    return out;
  }
}

// Same app-facing surface as DjiOm4 in gimbal.js.
export class FeiyuScorp extends EventTarget {
  constructor() {
    super();
    this.kind = 'scorp';
    this.device = null;
    this.tx = null;
    this.parser = new AkParser();
    this.rxCount = 0;
    this.battery = null;
    this.offset = { pan: 0, tilt: 0 };
    this.vel = { pan: 0, tilt: 0 };
    this.loop = null;
    this.zeroUntil = 0;
    this.write = serial();
    // maxSpeed: the deg/s we assume full joystick deflection gives. Tune on the real gimbal.
    this.settings = { invertPan: false, invertTilt: false, maxSpeed: 90 };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get name() { return this.device?.name || 'SCORP-C'; }
  get connected() { return !!this.device?.gatt?.connected; }
  get talking() { return this.rxCount > 0; }

  async connect(device) {
    this.device = device || await pickDevice({ namePrefix: NAME_PREFIX, extraServices: [SERVICE] });
    this.device.addEventListener('gattserverdisconnected', () => { this.stopLoop(); this.emit('state'); this.emit('log', `${this.name} disconnected`); });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    this.tx = await svc.getCharacteristic(WRITE_CHAR);
    const rx = await svc.getCharacteristic(NOTIFY_CHAR);
    rx.addEventListener('characteristicvaluechanged', (e) => this.onNotify(new Uint8Array(e.target.value.buffer)));
    await rx.startNotifications();
    this.offset = { pan: 0, tilt: 0 };
    this.emit('state');
    this.emit('log', `Connected to ${this.name}`);
  }

  disconnect() { this.stopLoop(); this.device?.gatt?.disconnect(); }

  onNotify(bytes) {
    for (const p of this.parser.push(bytes)) {
      this.rxCount++;
      this.emit('packet', p);
    }
    this.emit('state');
  }

  send(bytes) {
    if (!this.tx) return Promise.reject(new Error('Not connected'));
    return this.write(() => writeChunks(this.tx, bytes));
  }

  sendJoystick(panDps, tiltDps) {
    const k = JOYSTICK_MAX / this.settings.maxSpeed;
    const p = (this.settings.invertPan ? -panDps : panDps) * k;
    const t = (this.settings.invertTilt ? -tiltDps : tiltDps) * k;
    return this.send(joystickPacket(p, t)).catch((e) => this.emit('log', e.message));
  }

  setVelocity(pan, tilt) {
    const m = this.settings.maxSpeed;
    this.vel = { pan: Math.max(-m, Math.min(m, pan)), tilt: Math.max(-m, Math.min(m, tilt)) };
    if (!this.loop) this.startLoop();
  }

  // 30 Hz loop like the Feiyu app; keeps sending zero for 1 s after the stick is released.
  startLoop() {
    const dt = 1 / JOYSTICK_HZ;
    this.loop = setInterval(() => {
      const { pan, tilt } = this.vel;
      const moving = Math.abs(pan) > 0.3 || Math.abs(tilt) > 0.3;
      const now = Date.now();
      if (moving) this.zeroUntil = now + KEEP_ZERO_MS;
      else if (now > this.zeroUntil) { this.stopLoop(); return; }
      if (!this.connected) return;
      this.offset.pan += pan * dt;
      this.offset.tilt += tilt * dt;
      this.sendJoystick(moving ? pan : 0, moving ? tilt : 0);
    }, dt * 1000);
  }

  stopLoop() { clearInterval(this.loop); this.loop = null; this.vel = { pan: 0, tilt: 0 }; }

  // Smooth relative move made from joystick speed over time.
  moveBy(pan, tilt, seconds = 1) {
    const s = Math.max(0.1, seconds);
    this.setVelocity(pan / s, tilt / s);
    return new Promise((res) => setTimeout(() => { this.setVelocity(0, 0); res(); }, s * 1000));
  }

  // Drives back by the distance we think we've moved (like DjiOm4). The gimbal's own
  // "restore initial position" (use mode 2) is kept separate: on the real SCORP-C, joystick
  // control appeared to stop after it until a power cycle (2026-11-26 tests), so nothing
  // calls it automatically until that is confirmed or ruled out.
  recenter(seconds = 1.5) {
    const { pan, tilt } = this.offset;
    if (Math.abs(pan) < 0.5 && Math.abs(tilt) < 0.5) return Promise.resolve();
    return this.moveBy(-pan, -tilt, seconds);
  }

  restoreInitialPosition() {
    this.stopLoop();
    this.offset = { pan: 0, tilt: 0 };
    return this.send(recenterPacket()).catch((e) => this.emit('log', e.message));
  }

  setFollowMode(mode) { return this.send(followModePacket(mode)); }
}
