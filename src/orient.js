// Portrait ⇄ landscape on a phone gimbal (DJI OM): turn the roll motor while watching the
// phone's own gravity sensor, and stop when the phone is exactly upright or sideways.
// Proved on the owner's OM 5 (2026-11-26): roll speed commands rotate the phone clamp and it
// stays where it's left. The pure parts (phoneAngle, targetFor, rollSpeed) are unit-tested.

// Phone's rotation about the lens axis, degrees: 0 upright (portrait), ±90 sideways (landscape).
export function phoneAngle(gx, gy) { return (Math.atan2(gx, gy) * 180) / Math.PI; }

// Where to go next: from portrait to landscape (the side it already leans to), else upright.
export function targetFor(angle) {
  if (Math.abs(angle) < 45) return angle < -3 ? -90 : 90;
  return 0;
}

// Roll speed (deg/s, in "angle" terms) toward the target, slowing near the end.
export function rollSpeed(angle, target, { gain = 2, max = 60, min = 6 } = {}) {
  const err = target - angle;
  if (Math.abs(err) < 2.5) return 0;
  const v = Math.max(-max, Math.min(max, err * gain));
  return Math.abs(v) < min ? Math.sign(v) * min : v;
}

// Watches the phone's gravity sensor. angle is null until the first reading.
export class PhoneTilt {
  constructor() {
    this.angle = null;
    this.h = (e) => { const a = e.accelerationIncludingGravity; if (a && a.x != null) this.angle = phoneAngle(a.x, a.y); };
    addEventListener('devicemotion', this.h);
  }
  close() { removeEventListener('devicemotion', this.h); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// send(rollDegPerSec) drives the gimbal's roll motor. Returns { from, to, reached }.
// `sign` is learned with a small nudge first (which way the roll motor turns the phone).
export async function rotatePhone(send, { target, timeout = 8000, onProgress } = {}) {
  const tilt = new PhoneTilt();
  try {
    for (let i = 0; i < 20 && tilt.angle == null; i++) await wait(50);
    if (tilt.angle == null) throw new Error('No motion sensor — can’t tell which way the phone is turned');
    const from = tilt.angle;
    // "Landscape" means whichever side the phone already leans to; already there → nothing to do.
    let to = target === undefined ? targetFor(from) : target;
    if (Math.abs(to) === 90) to = Math.abs(from) > 45 ? Math.sign(from) * 90 : (from < -3 ? -90 : 90);
    if (Math.abs(to - from) < 6) return { from, to, reached: true, angle: from };
    // Nudge to learn direction.
    for (let i = 0; i < 4; i++) { send(30); await wait(100); }
    send(0); await wait(250);
    let sign = Math.sign(tilt.angle - from) || 1;
    // Nudged the wrong way relative to where we're going? that's fine, the loop handles it.
    const t0 = performance.now(); let settled = 0; let lastA = tilt.angle; let stuck = 0;
    while (performance.now() - t0 < timeout) {
      const v = rollSpeed(tilt.angle, to);
      if (v === 0) { if (++settled > 3) break; } else settled = 0;
      send(sign * v); onProgress?.(tilt.angle, to);
      await wait(100);
      // Moving the wrong way for half a second: flip the learned direction.
      if (v !== 0 && Math.sign(tilt.angle - lastA) === -Math.sign(v) && Math.abs(tilt.angle - lastA) > 1) { if (++stuck > 5) { sign = -sign; stuck = 0; } } else stuck = 0;
      lastA = tilt.angle;
    }
    send(0);
    await wait(300);
    return { from, to, reached: Math.abs(tilt.angle - to) < 6, angle: tilt.angle };
  } finally { send(0); tilt.close(); }
}
