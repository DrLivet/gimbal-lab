// Hand signals seen by the camera, for when voice can't hear you (wind, traffic, music).
//   ✋ open palm held ~1 s  → start / stop recording
//   ✌️ peace sign held ~1 s → follow on / off
// Uses MediaPipe's gesture model (vendored, works offline). HoldDetector is pure and unit-tested.

const BASE = new URL('../vendor/', import.meta.url).href;

export const GESTURES = { Open_Palm: 'palm', Victory: 'peace' };

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

  // Returns 'palm' | 'peace' | null for the current video frame.
  detect(video) {
    if (!this.task || video.readyState < 2 || !video.videoWidth) return null;
    const ts = Math.max(performance.now(), this.lastTs + 1); this.lastTs = ts;
    const r = this.task.recognizeForVideo(video, ts);
    for (const g of r.gestures || []) {
      const top = g[0];
      if (top && top.score > 0.6 && GESTURES[top.categoryName]) return GESTURES[top.categoryName];
    }
    return null;
  }
}
