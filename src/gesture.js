// Hand signals seen by the camera, for when voice can't hear you (wind, traffic, music).
//   ☝️ point one finger at the camera ~1 s → start / stop recording (✋ open palm too)
//   ✌️ peace sign held ~1 s → follow on / off
//   🔄 twist your hand like turning a knob → portrait ⇄ landscape
// Uses MediaPipe's gesture model (vendored, works offline). HoldDetector is pure and unit-tested.

const BASE = new URL('../vendor/', import.meta.url).href;

// Pointing_Up = one finger raised/pointed at the camera.
export const GESTURES = { Open_Palm: 'palm', Victory: 'peace', Pointing_Up: 'point' };

// Fires once when the same sign is seen for most of `hold` seconds, then needs the hand to
// go away for `rearm` seconds before that sign can fire again (so one wave = one action).
export class HoldDetector {
  constructor({ hold = 1.0, rearm = 0.8, ratio = 0.7 } = {}) {
    Object.assign(this, { hold, rearm, ratio });
    this.samples = []; this.lastSeen = {}; this.armed = {};
  }

  // sign: 'palm' | 'peace' | null, t: seconds. Returns the sign that fired, or null.
  update(sign, t) {
    this.samples.push({ sign, t });
    while (this.samples.length && t - this.samples[0].t > this.hold) this.samples.shift();
    if (sign) this.lastSeen[sign] = t;
    for (const k of Object.keys(this.lastSeen)) {
      if (this.armed[k] === false && t - this.lastSeen[k] >= this.rearm) this.armed[k] = true;
    }
    if (!sign || this.armed[sign] === false) return null;
    const span = t - this.samples[0].t;
    const hits = this.samples.filter((s) => s.sign === sign).length;
    if (span >= this.hold * 0.9 && hits / this.samples.length >= this.ratio) {
      this.armed[sign] = false; this.samples = [];
      return sign;
    }
    return null;
  }
}

// Hand twist angle, degrees: direction from the wrist (landmark 0) to the middle knuckle (9).
// Landmarks are 0..1 of width and height, so scale by the picture size (W×H) to get true angles
// in landscape and portrait alike.
export function handAngle(lm, W = 1, H = 1) {
  const w = lm[0]; const m = lm[9];
  return (Math.atan2((m.x - w.x) * W, -(m.y - w.y) * H) * 180) / Math.PI;   // 0 = fingers up
}

// Hand size as a fraction of the picture's longer side (same meaning in portrait and landscape).
export function handSize(lm, W = 1, H = 1) {
  const xs = lm.map((p) => p.x); const ys = lm.map((p) => p.y);
  return Math.max((Math.max(...xs) - Math.min(...xs)) * W, (Math.max(...ys) - Math.min(...ys)) * H) / Math.max(W, H);
}

// Fires 'turn' when one visible hand twists by at least `min` degrees within `within` seconds
// (like turning a dial), then waits `cooldown` seconds. Gaps of a frame or two are fine.
export class TwistDetector {
  constructor({ min = 80, within = 1.6, settle = 0.35, cooldown = 4 } = {}) {
    Object.assign(this, { min, within, settle, cooldown });
    this.hist = []; this.blockedUntil = -Infinity; this.lastT = -Infinity;
  }

  // angle: hand angle in degrees, or null when no hand. t: seconds.
  update(angle, t) {
    if (angle == null) { if (t - this.lastT > 0.4) this.hist = []; return null; }
    this.lastT = t;
    // unwrap so a twist through ±180 counts as continuous
    const prev = this.hist.at(-1);
    let a = angle;
    if (prev) { while (a - prev.a > 180) a -= 360; while (a - prev.a < -180) a += 360; }
    this.hist.push({ a, t });
    while (this.hist.length && t - this.hist[0].t > this.within) this.hist.shift();
    if (t < this.blockedUntil || this.hist.length < 3) return null;
    // A knob turn goes one way; a wave goes back and forth. Look for any stretch in the window
    // whose net turn is ≥ min while the path travelled is not much longer than that.
    // ...and it ends with the hand held at the new angle for a moment (a wave swings back).
    const h = this.hist;
    const tail = h.filter((x) => t - x.t <= this.settle);
    if (tail.length < 3 || Math.max(...tail.map((x) => x.a)) - Math.min(...tail.map((x) => x.a)) > 15) return null;
    const end = tail[0];   // where the turn finished
    for (let i = 0; h[i] !== end && i < h.length; i++) {
      const net = Math.abs(end.a - h[i].a);
      if (net < this.min) continue;
      let path = 0; for (let k = i + 1; h[k - 1] !== end; k++) path += Math.abs(h[k].a - h[k - 1].a);
      if (path <= net * 1.5) { this.hist = []; this.blockedUntil = t + this.cooldown; return 'turn'; }
    }
    return null;
  }
}

export class GestureWatcher {
  constructor() { this.task = null; this.lastTs = 0; }

  async load() {
    const mp = await import(`${BASE}mediapipe/vision_bundle.mjs`);
    const files = await mp.FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const make = (delegate) => mp.GestureRecognizer.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${BASE}models/gesture_recognizer.task`, delegate },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6,
    });
    try { this.task = await make('GPU'); } catch { this.task = await make('CPU'); }
    return this;
  }

  close() { try { this.task?.close(); } catch { /* ignore */ } this.task = null; }

  // Returns 'palm' | 'peace' | null for the current video frame; this.angle is the twist
  // angle of the first visible hand (or null).
  detect(video) {
    this.angle = null;
    if (!this.task || video.readyState < 2 || !video.videoWidth) return null;
    const ts = Math.max(performance.now(), this.lastTs + 1); this.lastTs = ts;
    const r = this.task.recognizeForVideo(video, ts);
    // A hand filling the picture is someone handling the phone/gimbal right at the lens,
    // not a gesture. (Measured against the longer side so landscape works like portrait.)
    this.handSize = 0;
    if (r.landmarks?.[0]?.length > 9) {
      const W = video.videoWidth; const H = video.videoHeight;
      this.handSize = handSize(r.landmarks[0], W, H);
      this.angle = this.handSize < 0.45 ? handAngle(r.landmarks[0], W, H) : null;
    }
    for (const g of r.gestures || []) {
      const top = g[0];
      if (top && top.score > 0.6 && GESTURES[top.categoryName]) return GESTURES[top.categoryName];
    }
    return null;
  }
}
