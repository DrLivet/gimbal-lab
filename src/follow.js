// Turns "where is the person in the picture" into "how fast should the gimbal turn".
// Pure logic, no browser APIs, so it is unit-tested in node (test/follow.test.mjs).
//
// Input: target {x, y, w, h} in 0..1 image coordinates (x→right, y→down), or null when lost.
// Output: {pan, tilt} in degrees per second. +pan turns toward the right of the picture,
// +tilt toward the top. Which way the motors actually go is handled per gimbal (invert flags).

export const FRAMING = {
  center: { x: 0.5, y: 0.42 },
  left: { x: 0.36, y: 0.42 },   // you sit on the left third, room for text/graphics on the right
  right: { x: 0.64, y: 0.42 },
};

export const DEFAULTS = {
  framing: 'center',
  hfov: 66,          // horizontal field of view of the camera, degrees
  vfov: 50,
  speed: 1,          // 0.3 (gentle) .. 2 (snappy)
  deadzone: 0.06,    // ignore drift smaller than this fraction of the frame
  maxSpeed: 60,      // deg/s
  tiltEnabled: true,
  lostAfter: 1.2,    // seconds without a face before we stop
  smoothing: 0.12,   // seconds of detector smoothing
  accel: 1,          // how quickly speed changes (lower = gentler starts/stops)
};

// Walking: the body bobs and the detector jumps more, so smooth harder, ignore small drift,
// keep turning a bit longer when you're briefly hidden, and ease speed changes.
export const WALKING = { smoothing: 0.3, accel: 0.55, deadzoneScale: 1.4, lostAfter: 2.5 };

export class Follow {
  constructor(settings = {}) {
    this.s = { ...DEFAULTS, ...settings };
    this.reset();
  }

  set(settings) { Object.assign(this.s, settings); }

  reset() {
    this.smooth = null;
    this.vel = { pan: 0, tilt: 0 };
    this.lostFor = 0;
    this.active = { x: false, y: false };
  }

  // dt in seconds since the previous update.
  update(target, dt) {
    const s = this.s;
    dt = Math.min(Math.max(dt, 0.001), 0.5);
    if (!target) {
      this.lostFor += dt;
      if (this.lostFor >= s.lostAfter) this.smooth = null;
      return this._approach({ pan: 0, tilt: 0 }, dt, this.lostFor >= s.lostAfter ? 8 : 3);
    }
    this.lostFor = 0;
    // Aim at the eyes rather than the box centre: a little above the middle of the face.
    const cx = target.x;
    const cy = target.y - target.h * 0.1;
    const a = 1 - Math.exp(-dt / s.smoothing); // smoothing of detector jitter
    this.smooth = this.smooth ? { x: this.smooth.x + a * (cx - this.smooth.x), y: this.smooth.y + a * (cy - this.smooth.y) }
      : { x: cx, y: cy };

    const goal = FRAMING[s.framing] || FRAMING.center;
    const ex = this.smooth.x - goal.x;          // + means person is right of where we want them
    const ey = goal.y - this.smooth.y;          // + means person is above where we want them
    // Deadzone with hysteresis: start correcting outside the zone, stop once well inside.
    this.active.x = Math.abs(ex) > (this.active.x ? s.deadzone * 0.4 : s.deadzone);
    this.active.y = s.tiltEnabled && Math.abs(ey) > (this.active.y ? s.deadzone * 0.5 : s.deadzone * 1.3);

    const gain = 2.2 * s.speed; // deg/s per degree of error
    const clamp = (v) => Math.max(-s.maxSpeed, Math.min(s.maxSpeed, v));
    const want = {
      pan: this.active.x ? clamp(ex * s.hfov * gain) : 0,
      tilt: this.active.y ? clamp(ey * s.vfov * gain) : 0,
    };
    return this._approach(want, dt, 6 * s.speed * s.accel);
  }

  // Rate-limits changes in speed so starts and stops are smooth (no jerks on camera).
  _approach(want, dt, rate) {
    const k = 1 - Math.exp(-dt * rate);
    this.vel.pan += (want.pan - this.vel.pan) * k;
    this.vel.tilt += (want.tilt - this.vel.tilt) * k;
    if (Math.abs(this.vel.pan) < 0.2 && want.pan === 0) this.vel.pan = 0;
    if (Math.abs(this.vel.tilt) < 0.2 && want.tilt === 0) this.vel.tilt = 0;
    return { ...this.vel };
  }
}

// Picks who to follow when several people are visible: stick with the person we were
// following (closest to last position), otherwise the biggest face.
export function pickTarget(candidates, last) {
  if (!candidates.length) return null;
  if (last) {
    let best = null; let bestD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x - last.x, c.y - last.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (bestD < 0.25) return best;
  }
  return candidates.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
}

// How directly someone faces the camera, 0..1, from eye/nose keypoints (face detector order:
// right eye, left eye, nose tip, mouth, right ear, left ear). Used to pick the live camera.
export function facingScore(kp) {
  if (!kp || kp.length < 3) return 0.5;
  const [re, le, nose] = kp;
  const eyeMid = (re.x + le.x) / 2;
  const eyeDist = Math.abs(le.x - re.x) || 1e-3;
  const turn = Math.abs(nose.x - eyeMid) / eyeDist; // 0 when looking straight at the lens
  return Math.max(0, 1 - turn * 1.6);
}
