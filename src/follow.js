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

// Camera field of view for the picture's shape: phones held upright (portrait) see
// narrower left-right and taller up-down than the usual landscape numbers.
export function fovFor(width, height, wide = 66, narrow = 50) {
  return height > width ? { hfov: narrow, vfov: wide } : { hfov: wide, vfov: narrow };
}

export const DEFAULTS = {
  framing: 'center',
  hfov: 66,          // horizontal field of view of the camera, degrees
  vfov: 50,
  speed: 1,          // 0.3 (gentle) .. 2 (snappy)
  deadzone: 0.06,    // ignore drift smaller than this fraction of the frame
  maxSpeed: 120,     // deg/s
  tiltEnabled: true,
  lostAfter: 1.2,    // seconds without a face before we stop
  smoothing: 0.12,   // seconds of detector smoothing
  accel: 1,          // how quickly speed changes (lower = gentler starts/stops)
  gain: 1.5,         // deg/s of turn per degree you are off-target (before `speed`)
  latency: 0.45,
  matchSpeed: 1.1,    // how much of the person's own speed to add (feed-forward)
  coast: 1.5,        // seconds to keep turning after the person leaves the picture
  moveSpeed: 10,     // deg/s: slower than this counts as sitting still     // tuned on the owner's OM 5 (Bluetooth + camera + detector ≈ 0.3–0.5 s)        // seconds between a turn command and seeing it in the picture
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
    this.cam = { pan: 0, tilt: 0 };      // where we've told the camera to be (sum of commands)
    this.time = 0; this.camHist = [];    // past camera positions, to know where it was per picture
    this.world = null;                   // where the person is, in the same angles
    this.pv = { pan: 0, tilt: 0 };       // how fast the person is moving, deg/s
    this.stillFor = 0;                   // seconds the person has been framed and still
  }

  // dt in seconds since the previous update.
  update(target, dt) {
    const s = this.s;
    dt = Math.min(Math.max(dt, 0.001), 0.5);
    this.cam.pan += this.vel.pan * dt; this.cam.tilt += this.vel.tilt * dt;
    this.time += dt; this.camHist.push({ t: this.time, pan: this.cam.pan, tilt: this.cam.tilt });
    while (this.camHist.length > 2 && this.camHist[1].t < this.time - s.latency) this.camHist.shift();
    const camSeen = this.camHist[0];   // roughly where the camera was when this picture was taken
    if (!target) {
      this.lostFor += dt;
      if (this.lostFor >= s.lostAfter) { this.smooth = null; this.world = null; }
      // Just left the picture: keep turning the way you were going (you probably walked out
      // of frame faster than we turned), easing off over `coast` seconds.
      if (this.lostFor < s.coast && (Math.abs(this.pv.pan) > s.moveSpeed || Math.abs(this.pv.tilt) > s.moveSpeed)) {
        // Full speed for most of the coast (a bit faster, to catch up), easing off at the end.
        const k = Math.min(1, 3 * (1 - this.lostFor / s.coast)) * 1.15;
        return this._approach(this._cap({ pan: this.pv.pan * k, tilt: s.tiltEnabled ? this.pv.tilt * k : 0 }), dt, 10 * s.accel);
      }
      this.pv = { pan: 0, tilt: 0 };
      return this._approach({ pan: 0, tilt: 0 }, dt, this.lostFor >= s.lostAfter ? 8 : 3);
    }
    this.lostFor = 0;
    // Aim at the eyes rather than the box centre: a little above the middle of the face.
    const cx = target.x;
    const cy = target.y - target.h * 0.1;
    const a = 1 - Math.exp(-dt / s.smoothing); // smoothing of detector jitter
    this.smooth = this.smooth ? { x: this.smooth.x + a * (cx - this.smooth.x), y: this.smooth.y + a * (cy - this.smooth.y) }
      : { x: cx, y: cy };

    // Person's direction in the room = camera direction when the picture was taken + offset in it.
    const w = { pan: camSeen.pan + (this.smooth.x - 0.5) * s.hfov, tilt: camSeen.tilt + (0.5 - this.smooth.y) * s.vfov };
    if (this.world) {
      const b = 1 - Math.exp(-dt / 0.2);   // smooth the speed estimate
      const lim = (v) => Math.max(-150, Math.min(150, v));
      this.pv.pan += b * (lim((w.pan - this.world.pan) / dt) - this.pv.pan);
      this.pv.tilt += b * (lim((w.tilt - this.world.tilt) / dt) - this.pv.tilt);
    }
    this.world = w;

    const goal = FRAMING[s.framing] || FRAMING.center;
    // The picture is `latency` old. Compare where the person will be once our commands land
    // (smoothed position + their speed × latency) with where we've already told the camera to go.
    // This stops overshoot when still and stops lagging behind when they move.
    const pred = (axis, sm, fov, sign) => camSeen[axis] + sign * (sm - 0.5) * fov + this.pv[axis] * s.latency - this.cam[axis];
    const ex = pred('pan', this.smooth.x, s.hfov, 1) / s.hfov - (goal.x - 0.5);    // + : person right of target
    const ey = pred('tilt', this.smooth.y, s.vfov, -1) / s.vfov - (0.5 - goal.y);  // + : person above target
    // Deadzone with hysteresis: start correcting outside the zone, stop once well inside.
    // You're "moving" only above a speed that detector wobble never reaches.
    const moving = (v) => Math.abs(v) > s.moveSpeed;
    // Once you've sat framed and still for half a second, hold completely still and ignore
    // small wobbles: restart only on a real move or a clear drift out of the middle.
    const inner = Math.abs(ex) < s.deadzone * 0.5 && Math.abs(ey) < s.deadzone * 0.7;
    const still = !moving(this.pv.pan) && !moving(this.pv.tilt);
    this.stillFor = inner && still ? this.stillFor + dt : (still ? this.stillFor : 0);
    const hold = this.stillFor > 0.5 ? 1.6 : 1;   // bigger zone when settled
    this.active.x = moving(this.pv.pan) || Math.abs(ex) > (this.active.x ? s.deadzone * 0.4 : s.deadzone * hold);
    this.active.y = s.tiltEnabled && (moving(this.pv.tilt) || Math.abs(ey) > (this.active.y ? s.deadzone * 0.5 : s.deadzone * 1.3 * hold));
    if (this.active.x || this.active.y) { if (!inner) this.stillFor = 0; }

    const gain = s.gain * s.speed; // deg/s per degree of error
    // Match the person's own speed (feed-forward) so a fast walk doesn't leave us behind.
    const ff = (v) => (moving(v) ? v * s.matchSpeed : 0);
    const want = {
      pan: this.active.x ? ex * s.hfov * gain + ff(this.pv.pan) : 0,
      tilt: this.active.y ? ey * s.vfov * gain + ff(this.pv.tilt) : 0,
    };
    // Close to the edge of the picture: turn harder before we lose them.
    // Respond faster to a real move or near the edge; gently when just re-centring.
    const edge = Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5));
    const urgent = moving(this.pv.pan) || moving(this.pv.tilt) || edge > 0.3;
    return this._approach(this._cap(want), dt, 6 * s.speed * s.accel * (urgent ? 4 : 1));
  }

  _cap(v) {
    const m = this.s.maxSpeed; const c = (x) => Math.max(-m, Math.min(m, x));
    return { pan: c(v.pan), tilt: c(v.tilt) };
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
