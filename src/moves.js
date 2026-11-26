// Repeatable camera moves. A move is a list of points {pan, tilt, secs}: each point is where to
// be (degrees, relative to where the move starts) and how long to take getting there.
// The gimbal's single-move limit is 25.5 s, so long legs are split.

export const PRESETS = [
  { id: 'slow-pan', name: 'Slow pan', points: [{ pan: -30, tilt: 0, secs: 2 }, { pan: 30, tilt: 0, secs: 20 }, { pan: 0, tilt: 0, secs: 3 }] },
  { id: 'reveal', name: 'Reveal (tilt up)', points: [{ pan: 0, tilt: -25, secs: 2 }, { pan: 0, tilt: 0, secs: 6 }] },
  { id: 'sweep', name: 'Look around', points: [{ pan: -45, tilt: 0, secs: 4 }, { pan: 45, tilt: 0, secs: 8 }, { pan: 0, tilt: 0, secs: 4 }] },
  { id: 'timelapse', name: 'Timelapse pan (2 min)', points: [{ pan: -60, tilt: 0, secs: 3 }, { pan: 60, tilt: 0, secs: 120 }] },
];

const KEY = 'moves.custom';
export function loadCustom() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
export function saveCustom(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } }

// Plans a move as a list of gimbal commands {pan, tilt, secs} (relative deltas, each <= 25 s).
export function plan(points, from = { pan: 0, tilt: 0 }) {
  const out = [];
  let cur = { ...from };
  for (const p of points) {
    const legs = Math.max(1, Math.ceil(p.secs / 25));
    const dp = (p.pan - cur.pan) / legs; const dt = (p.tilt - cur.tilt) / legs;
    for (let i = 0; i < legs; i++) out.push({ pan: dp, tilt: dt, secs: p.secs / legs });
    cur = { pan: p.pan, tilt: p.tilt };
  }
  return out;
}

// Plays a move on a gimbal. Returns a handle with stop(). onStep(i, n) reports progress.
export function play(gimbal, points, onStep = () => {}) {
  const steps = plan(points);
  let stopped = false; let timer = null;
  const done = new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (stopped || i >= steps.length) return resolve(!stopped);
      const s = steps[i++];
      onStep(i, steps.length);
      gimbal.moveBy(s.pan, s.tilt, Math.max(0.1, s.secs));
      timer = setTimeout(next, Math.max(100, s.secs * 1000 - 150)); // start next leg just before this ends
    };
    next();
  });
  return { done, stop() { stopped = true; clearTimeout(timer); gimbal.setVelocity(0, 0); } };
}

// Records a custom move: call add() at each point while you position the gimbal with the joystick.
export class MoveRecorder {
  constructor(gimbal) { this.g = gimbal; this.start = { ...gimbal.offset }; this.points = []; this.t = performance.now(); }
  add() {
    const now = performance.now();
    const secs = this.points.length ? Math.max(1, Math.round((now - this.t) / 100) / 10) : 2;
    this.t = now;
    this.points.push({ pan: this.g.offset.pan - this.start.pan, tilt: this.g.offset.tilt - this.start.tilt, secs });
    return this.points.length;
  }
}
