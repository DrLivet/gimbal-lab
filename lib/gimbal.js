// App-facing gimbal interface. Every gimbal model implements the same small surface,
// so tracking, voice, saved moves and the studio don't care which one they drive:
//
//   connect() / disconnect() / connected
//   setVelocity(panDegPerSec, tiltDegPerSec)   continuous motion (tracking, joystick)
//   moveBy(panDeg, tiltDeg, seconds)           one smooth relative move (saved moves)
//   recenter()                                  back to where it was when we connected
//   offset {pan, tilt}                          where we think it points, relative to connect
//   events: 'state' (connected/battery/position changed), 'log' (text)
//
// DJI OM 4 lives here; the Feiyu SCORP-C driver is in feiyu.js.
import { OsmoMobile, LADDER } from './om.js';
import { ROT } from './duml.js';
import { FeiyuScorp } from './feiyu.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const MODELS = {
  om4: { label: 'DJI OM 4', create: () => new DjiOm4() },
  scorp: { label: 'Feiyu SCORP-C', create: () => new FeiyuScorp() },
};

export class DjiOm4 extends EventTarget {
  constructor() {
    super();
    this.kind = 'om4';
    this.om = new OsmoMobile();
    this.offset = { pan: 0, tilt: 0 };
    this.vel = { pan: 0, tilt: 0 };
    this.loop = null;
    this.settings = { method: 'step', invertPan: false, invertTilt: false, maxSpeed: 90 };
    this.om.addEventListener('packet', () => this.emit('state'));
    this.om.addEventListener('disconnected', () => { this.stopLoop(); this.emit('state'); this.emit('log', `${this.name} disconnected`); });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get name() { return this.om.device?.name || 'OM 4'; }
  get connected() { return !!this.om.device?.gatt?.connected; }
  get battery() { return this.om.battery; }
  get talking() { return this.om.rxCount > 0; }

  async connect() {
    await this.om.connect();
    this.offset = { pan: 0, tilt: 0 };
    await this.wake();
    this.emit('state');
    this.emit('log', `Connected to ${this.name}`);
  }

  disconnect() { this.stopLoop(); this.om.disconnect(); }

  // Replays the "wake-up" preparation. Uses the step Gimbal Lab found, or all of them.
  async wake() {
    let stop = null;
    try { stop = localStorage.getItem('om4.wakeStep'); } catch { /* ignore */ }
    for (const step of LADDER) {
      if (step.prep && !['feature'].includes(step.id)) await step.prep(this.om);
      if (step.id === stop) break;
    }
  }

  // Raw relative move in gimbal units (yaw = pan, pitch = tilt).
  _rotate(pan, tilt, seconds) {
    const p = this.settings.invertPan ? -pan : pan;
    const t = this.settings.invertTilt ? -tilt : tilt;
    this.offset.pan += pan;
    this.offset.tilt += tilt;
    return this.om.rotate({ yaw: p, pitch: t, time: clamp(seconds, 0.1, 25.5) }).catch((e) => this.emit('log', e.message));
  }

  moveBy(pan, tilt, seconds = 1) { return this._rotate(pan, tilt, seconds); }

  recenter(seconds = 1.5) {
    const { pan, tilt } = this.offset;
    if (Math.abs(pan) < 0.5 && Math.abs(tilt) < 0.5) return Promise.resolve();
    return this._rotate(-pan, -tilt, seconds);
  }

  setVelocity(pan, tilt) {
    const m = this.settings.maxSpeed;
    this.vel = { pan: clamp(pan, -m, m), tilt: clamp(tilt, -m, m) };
    const moving = Math.abs(this.vel.pan) > 0.3 || Math.abs(this.vel.tilt) > 0.3;
    if (moving && !this.loop) this.startLoop();
    if (!moving && this.loop && this.settings.method === 'speed') this.sendSpeed(0, 0);
  }

  // 10 Hz control loop. 'step' sends small relative moves; 'speed' uses the gimbal's speed command.
  startLoop() {
    const dt = 0.1;
    let idle = 0;
    this.loop = setInterval(() => {
      const { pan, tilt } = this.vel;
      const moving = Math.abs(pan) > 0.3 || Math.abs(tilt) > 0.3;
      if (!moving) { if (++idle > 10) this.stopLoop(); return; }
      idle = 0;
      if (!this.connected) return;
      if (this.settings.method === 'speed') this.sendSpeed(pan, tilt);
      else this._rotate(pan * dt, tilt * dt, dt * 1.5);
    }, dt * 1000);
  }

  sendSpeed(pan, tilt) {
    const p = this.settings.invertPan ? -pan : pan;
    const t = this.settings.invertTilt ? -tilt : tilt;
    this.offset.pan += pan * 0.1;
    this.offset.tilt += tilt * 0.1;
    return this.om.rotate({ yaw: p, pitch: t, mode: ROT.SPEED, time: 0 }).catch(() => {});
  }

  stopLoop() { clearInterval(this.loop); this.loop = null; this.vel = { pan: 0, tilt: 0 }; }
}
